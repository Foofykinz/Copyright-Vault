#!/usr/bin/env python3
"""
SQUEEZE GPU v2 — Copyright Evidence Tool
Project-based workflow: Fetch → Upload → Combine/Normalize → Compress → Export
Cleanup policy: only the final exported file is kept; all intermediates are deleted.
"""

import subprocess, sys, os, json, threading, uuid, shutil, time, re, csv, io
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, send_file, send_from_directory

# Suppress console windows on Windows for every subprocess we spawn.
# On non-Windows platforms this flag is 0 so it has no effect.
_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# Port the app serves on. Defaults to 7842 -- exactly what everyone uses today. The override exists
# so a second copy (a test install, or one being updated) can run beside a real one without the
# single-instance lock shutting the real one down.
PORT = int(os.environ.get("SQUEEZE_PORT", "7842"))
LOCK_PORT = PORT + 1

# ── Auto-install deps ──────────────────────────────────────────────────────────
for pkg, imp in [("flask","flask"),("python-dateutil","dateutil")]:
    try: __import__(imp)
    except ImportError:
        print(f"Installing {pkg}...")
        subprocess.check_call([sys.executable,"-m","pip","install",pkg,"--quiet"],
                              creationflags=_NO_WINDOW)

# yt-dlp needs to be kept CURRENT, not just present — Instagram/TikTok/etc.
# change often enough that yt-dlp ships fixes for them almost every release.
# A copy installed once and never touched again silently goes stale and
# downloads start failing with no obvious cause (this is exactly what
# happened here — 4 months stale). Try to upgrade on every startup; never
# let a failed upgrade check block startup if a working copy already exists.
try:
    __import__("yt_dlp")
    _had_yt_dlp = True
except ImportError:
    _had_yt_dlp = False

try:
    if os.environ.get("SQUEEZE_SKIP_PIP_UPGRADE") and _had_yt_dlp:
        raise RuntimeError("skipped by SQUEEZE_SKIP_PIP_UPGRADE")  # test-only escape hatch
    print("Installing yt-dlp..." if not _had_yt_dlp else "Checking for yt-dlp updates...")
    subprocess.run([sys.executable, "-m", "pip", "install", "--upgrade", "yt_dlp", "--quiet"],
                   creationflags=_NO_WINDOW, timeout=20)
except Exception:
    if not _had_yt_dlp:
        print("\n⚠  Could not install yt-dlp and no existing copy was found. "
              "Check your internet connection and try again.\n")
        input("Press Enter to exit..."); sys.exit(1)
    print("  (Could not check for yt-dlp updates — using the existing installed copy.)")

import yt_dlp
from dateutil import parser as dateutil_parser

# Self-update (see squeeze_update.py). If that module ever can't load, Squeeze itself must still run.
try:
    import squeeze_update as upd
except Exception as _upd_err:
    upd = None
    print(f"  (Self-update unavailable: {_upd_err})")

app = Flask(__name__, static_folder="ui")

WORK_DIR = Path("squeeze_work")   # temp working area — gets wiped per-project on export
WORK_DIR.mkdir(exist_ok=True)

# Rights Manager gets its own separate scratch area so it never interacts with
# the Squeeze/Batch cleanup routines (startup_cleanup/api_cleanup only ever
# look inside WORK_DIR) — a fully independent workflow, per design.
RIGHTS_WORK_DIR = Path("squeeze_rights_work")
RIGHTS_WORK_DIR.mkdir(exist_ok=True)

# In-memory state
projects   = {}   # { pid: { id, name, created, videos, final_proc_id } }
dl_jobs    = {}   # { dl_id: {...} }
proc_jobs  = {}   # { proc_id: {...} }
state_lock = threading.Lock()

SIZE_LIMIT_BYTES = 450 * 1024 * 1024  # 450 MB

# Heartbeat — browser pings every 5s; if we miss 3 in a row we shut down
_last_heartbeat = time.time()
_HEARTBEAT_TIMEOUT = 300  # seconds (5 minutes — long enough to survive any encode)

# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════

def save_projects():
    (WORK_DIR / "index.json").write_text(
        json.dumps({pid:{k:v for k,v in p.items()} for pid,p in projects.items()}, indent=2)
    )

def load_projects():
    f = WORK_DIR / "index.json"
    if f.exists():
        try:
            for pid, p in json.loads(f.read_text()).items():
                projects[pid] = p
        except: pass

def startup_cleanup():
    """
    On every launch, wipe any project subdirectories inside squeeze_work
    that have no matching entry in index.json — these are orphans left
    behind by crashes, browser closes mid-session, or the old purge bug.
    Runs once at startup before Flask starts accepting requests.
    """
    if not WORK_DIR.exists():
        return
    known_pids = set(projects.keys())
    wiped = 0
    for d in WORK_DIR.iterdir():
        if not d.is_dir():
            continue
        if d.name in known_pids:
            continue
        # Wipe it — it's either orphaned or already exported
        try:
            shutil.rmtree(d, ignore_errors=True)
            wiped += 1
            print(f"  Cleanup: removed orphaned work dir {d.name}")
        except Exception as e:
            print(f"  Cleanup: could not remove {d.name}: {e}")
    if wiped:
        print(f"  Startup cleanup: removed {wiped} orphaned folder(s).")

def project_dir(pid):
    d = WORK_DIR / pid
    d.mkdir(exist_ok=True)
    return d

def ffmpeg_ok():
    try: return subprocess.run(["ffmpeg","-version"],capture_output=True,timeout=5,creationflags=_NO_WINDOW).returncode==0
    except: return False

def detect_gpu():
    candidates = []
    if sys.platform == "darwin":
        candidates.append(
            {"brand":"videotoolbox","enc_h264":"h264_videotoolbox","enc_hevc":"hevc_videotoolbox",
             "label":"Apple VideoToolbox",
             "test":["-f","lavfi","-i","nullsrc=s=64x64:d=1","-c:v","h264_videotoolbox","-f","null","-"]}
        )
    candidates += [
        {"brand":"nvidia","enc_h264":"h264_nvenc","enc_hevc":"hevc_nvenc","label":"NVIDIA NVENC",
         "test":["-f","lavfi","-i","nullsrc=s=64x64:d=1","-c:v","h264_nvenc","-f","null","-"]},
         {"brand":"amd","enc_h264":"h264_mf","enc_hevc":"hevc_mf","label":"AMD (Media Foundation)",
          "test":["-f","lavfi","-i","nullsrc=s=64x64:d=1","-c:v","h264_mf","-f","null","-"]},
        {"brand":"intel","enc_h264":"h264_qsv","enc_hevc":"hevc_qsv","label":"Intel Quick Sync",
         "test":["-f","lavfi","-i","nullsrc=s=64x64:d=1","-c:v","h264_qsv","-f","null","-"]},
    ]
    for c in candidates:
        try:
            r = subprocess.run(["ffmpeg"]+c["test"], capture_output=True, timeout=10, creationflags=_NO_WINDOW)
            if r.returncode == 0:
                return c
        except: pass

    return {"brand":"cpu","enc_h264":"libx264","enc_hevc":"libx265","label":"CPU (libx264)","test":[]}

GPU_INFO = None
def get_gpu():
    global GPU_INFO
    if GPU_INFO is None: GPU_INFO = detect_gpu()
    return GPU_INFO

def _yt_date_to_iso(raw):
    """Convert yt-dlp's own upload_date format (YYYYMMDD) to YYYY-MM-DD, or '' if unusable."""
    raw = raw or ""
    if len(raw) == 8 and raw.isdigit():
        return f"{raw[0:4]}-{raw[4:6]}-{raw[6:8]}"
    return ""

def get_video_info(path):
    try:
        r = subprocess.run([
            "ffprobe","-v","error","-select_streams","v:0",
            "-show_entries","stream=width,height,duration",
            "-show_entries","format=duration,size","-of","json",str(path)
        ],capture_output=True,text=True,timeout=15,creationflags=_NO_WINDOW)
        d = json.loads(r.stdout)
        fmt = d.get("format",{})
        st  = d.get("streams",[{}])
        dur  = float(fmt.get("duration") or (st[0].get("duration") if st else 0) or 0)
        size = int(fmt.get("size") or Path(path).stat().st_size)
        w = int(st[0].get("width",0)) if st else 0
        h = int(st[0].get("height",0)) if st else 0
        return {"duration_s":dur,"size_bytes":size,"width":w,"height":h}
    except:
        sz = Path(path).stat().st_size if Path(path).exists() else 0
        return {"duration_s":0,"size_bytes":sz,"width":0,"height":0}

def log_proc(pid, msg):
    with state_lock:
        if pid in proc_jobs: proc_jobs[pid]["log"].append(msg)

def upd_proc(pid, **kw):
    with state_lock:
        if pid in proc_jobs: proc_jobs[pid].update(kw)

def safe_delete(path):
    """Delete a file silently."""
    try: Path(path).unlink()
    except: pass

def wipe_project_work(pid):
    """Delete entire project working directory."""
    d = WORK_DIR / pid
    shutil.rmtree(d, ignore_errors=True)
    # Also remove from index so it doesn't show stale data
    with state_lock:
        projects.pop(pid, None)
        save_projects()

# ══════════════════════════════════════════════════════════════════════════════
# DOWNLOAD
# ══════════════════════════════════════════════════════════════════════════════

_COOKIE_BROWSER = None
_COOKIE_BROWSER_CHECKED = False

def _detect_cookie_browser():
    """
    Find a browser that's already logged into things like Instagram, so
    yt-dlp's own requests can reuse that same session — this is what keeps
    downloads working now that Instagram increasingly refuses fully
    anonymous requests, with no manual cookie export and no separate
    dedicated account: it just uses whatever the person running SQUEEZE is
    already logged into on their own machine, same as it's always been.
    Probed once per app run (probing is somewhat slow and, on macOS, can
    trigger a Keychain permission prompt) and cached after that.
    """
    global _COOKIE_BROWSER, _COOKIE_BROWSER_CHECKED
    if _COOKIE_BROWSER_CHECKED:
        return _COOKIE_BROWSER
    _COOKIE_BROWSER_CHECKED = True
    import yt_dlp.cookies as yt_cookies
    for browser in ("chrome", "edge", "brave", "firefox", "vivaldi", "chromium", "opera", "safari"):
        try:
            jar = yt_cookies.extract_cookies_from_browser(browser)
            if len(jar) > 0:
                print(f"  Using saved login from {browser.title()} for sites that need one (e.g. Instagram).")
                _COOKIE_BROWSER = browser
                return browser
        except Exception:
            continue
    print("  No logged-in browser found — sites that require a login (Instagram, sometimes) may fail.")
    return None

def run_download(dl_id, url, quality, dest_dir):
    def upd(**kw):
        with state_lock: dl_jobs[dl_id].update(kw)
    def lg(msg):
        with state_lock: dl_jobs[dl_id]["log"].append(msg)
    def hook(d):
        if d["status"]=="downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done  = d.get("downloaded_bytes",0)
            spd   = d.get("speed") or 0
            pct   = int((done/total)*100) if total else 0
            with state_lock:
                dl_jobs[dl_id]["progress"] = pct
                dl_jobs[dl_id]["speed"] = f"{spd/1024/1024:.1f} MB/s" if spd>0 else "..."
        elif d["status"]=="finished":
            with state_lock: dl_jobs[dl_id]["progress"]=99
            lg("Finalizing...")

    # Format strings: prefer H.264 (avc1) explicitly — platforms like YouTube
    # often serve AV1 or VP9 inside an mp4-labeled container at 720p+, which
    # plays back inconsistently in many players/editors. Falling back to
    # mp4-without-codec-filter, then finally "best" so Instagram/Facebook/
    # TikTok (which don't always expose separate mp4+m4a streams) still get
    # downloaded rather than erroring out. Anything that still isn't H.264
    # gets caught and transcoded by _ensure_h264() right after download.
    fmt_map = {
        "best": "bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio/bestvideo+bestaudio/best",
        "1080": "bestvideo[vcodec^=avc1][height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best",
        "720":  "bestvideo[vcodec^=avc1][height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
        "480":  "bestvideo[vcodec^=avc1][height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/bestvideo[height<=480]+bestaudio/best[height<=480]/best",
    }
    out_tmpl = str(Path(dest_dir) / f"{dl_id}_%(title).60s.%(ext)s")
    opts = {
        "format": fmt_map.get(quality, fmt_map["best"]),
        "outtmpl": out_tmpl,
        "progress_hooks": [hook],
        "merge_output_format": "mp4",
        "quiet": True, "no_warnings": True,
        "postprocessors": [{"key":"FFmpegVideoConvertor","preferedformat":"mp4"}],
    }
    cookie_browser = _detect_cookie_browser()
    if cookie_browser:
        opts["cookiesfrombrowser"] = (cookie_browser,)
    upd(status="running", progress=0)
    lg(f"Fetching: {url}")
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
        cands = list(Path(dest_dir).glob(f"{dl_id}_*.mp4")) or list(Path(dest_dir).glob(f"{dl_id}_*"))
        if not cands: raise FileNotFoundError("Output not found")
        out  = max(cands, key=lambda p: p.stat().st_size)
        out  = _ensure_h264(out, get_gpu())
        vi   = get_video_info(out)
        title    = info.get("title","Unknown")
        platform = info.get("extractor_key","Unknown")
        thumb    = info.get("thumbnail","")
        date     = _yt_date_to_iso(info.get("upload_date"))  # original post date, not download date
        upd(status="done", progress=100,
            output_path=str(out), filename=out.name,
            file_size=vi["size_bytes"], duration_s=vi["duration_s"],
            title=title, platform=platform, thumbnail=thumb, date=date,
            width=vi["width"], height=vi["height"])
        lg(f"Done — {vi['size_bytes']/1024/1024:.1f} MB")
        with state_lock:
            pid = dl_jobs[dl_id]["project_id"]
            if pid in projects:
                projects[pid]["videos"].append({
                    "id":dl_id,"type":"download","path":str(out),
                    "filename":out.name,"title":title,"platform":platform,
                    "thumbnail":thumb,"date":date,"size_bytes":vi["size_bytes"],
                    "duration_s":vi["duration_s"],"width":vi["width"],
                    "height":vi["height"],"url":url,
                })
                save_projects()
    except Exception as e:
        upd(status="error")
        lg(f"Error: {e}")

# ══════════════════════════════════════════════════════════════════════════════
# COMBINE + NORMALIZE
# Audio spec (universal social media safe):
#   AAC-LC · 48 kHz · stereo · 192 kbps · EBU R128 loudnorm -16 LUFS
# ══════════════════════════════════════════════════════════════════════════════

def get_dimensions(path):
    """Return (width, height) of a video file."""
    try:
        r = subprocess.run([
            "ffprobe","-v","error","-select_streams","v:0",
            "-show_entries","stream=width,height",
            "-of","csv=p=0", str(path)
        ], capture_output=True, text=True, timeout=10, creationflags=_NO_WINDOW)
        parts = r.stdout.strip().split(",")
        return int(parts[0]), int(parts[1])
    except:
        return 1920, 1080

def get_video_codec(path):
    """Return the lowercase codec name of the first video stream (e.g. 'h264', 'av01', 'vp9')."""
    try:
        r = subprocess.run([
            "ffprobe","-v","error","-select_streams","v:0",
            "-show_entries","stream=codec_name","-of","default=nw=1:nk=1", str(path)
        ], capture_output=True, text=True, timeout=15, creationflags=_NO_WINDOW)
        return r.stdout.strip().lower()
    except:
        return ""

def pick_canvas(video_paths):
    """
    Pick a canvas size that fits all clips without cropping any of them.
    Uses the largest width and largest height seen across all clips,
    each rounded up to the nearest even number (required by H.264).
    """
    max_w, max_h = 0, 0
    for p in video_paths:
        w, h = get_dimensions(p)
        max_w = max(max_w, w)
        max_h = max(max_h, h)
    # Round up to even
    max_w = max_w + (max_w % 2)
    max_h = max_h + (max_h % 2)
    return max_w, max_h

def _normalize_single(proc_id, src, dst, gpu, quiet=False, target_w=1920, target_h=1080, mute=False):
    pix_fmt = "nv12" if gpu["brand"] in ("amd","videotoolbox") else "yuv420p"
    if gpu["brand"]=="nvidia":        q_args=["-cq","23","-b:v","0"]
    elif gpu["brand"]=="amd":         q_args=["-usage","transcoding","-profile:v","high","-quality","balanced","-rc","cqp","-qp_i","23","-qp_p","25","-qp_b","27"]
    elif gpu["brand"]=="intel":       q_args=["-b:v","4M","-maxrate","8M"]
    elif gpu["brand"]=="videotoolbox": q_args=["-b:v","6M","-maxrate","10M","-profile:v","high"]
    else:                              q_args=["-crf","23","-preset","medium"]

    vf = (f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
          f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black,"
          f"fps=30,format={pix_fmt}")
    # Mute by zeroing the audio samples rather than dropping the audio stream
    # entirely — every clip going into a combine needs to keep an audio
    # stream with the same codec/rate/channels as the others so ffmpeg's
    # concat demuxer can stitch them with a plain stream copy; a silent-but-
    # present track is what makes that still work for a muted clip.
    af_args = ["-af", "volume=0"] if mute else []

    enc = gpu["enc_h264"] if gpu["brand"] != "cpu" else "libx264"

    def _run(encoder, qargs, fmt):
        args = ["ffmpeg","-y","-i",str(src),"-vf",
                f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
                f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black,"
                f"fps=30,format={fmt}",
                "-c:v",encoder,*qargs,
                *af_args,
                "-c:a","aac","-ac","2","-ar","48000","-b:a","192k",
                "-movflags","+faststart",str(dst)]
        r = subprocess.run(args, capture_output=True, text=True, creationflags=_NO_WINDOW)
        return r.returncode == 0

    if not quiet: log_proc(proc_id, f"Normalizing: {Path(src).name}" + (" (muting audio)" if mute else ""))

    success = _run(enc, q_args, pix_fmt)
    if not success and gpu["brand"] != "cpu":
        if not quiet: log_proc(proc_id, f"GPU failed — retrying with CPU...")
        if Path(dst).exists(): Path(dst).unlink()
        success = _run("libx264", ["-crf","23","-preset","medium"], "yuv420p")
    if not success:
        r = subprocess.run(
            ["ffmpeg","-y","-i",str(src),"-vf",
             f"scale={target_w}:{target_h}:force_original_aspect_ratio=decrease,"
             f"pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2:color=black,"
             f"fps=30,format=yuv420p",
             "-c:v","libx264","-crf","23","-preset","medium",
             *af_args,
             "-c:a","aac","-ac","2","-ar","48000","-b:a","192k",
             "-movflags","+faststart",str(dst)],
            capture_output=True, text=True, creationflags=_NO_WINDOW)
        if r.returncode != 0:
            raise RuntimeError(r.stderr[-400:])


def _ensure_h264(path, gpu, proc_id=None):
    """
    Guarantee a video file is H.264 before it's treated as final output.
    yt-dlp can return AV1 or VP9 streams (common on YouTube at 720p+, or
    whenever a platform doesn't offer an H.264 mux), and users can upload
    HEVC/ProRes/etc. directly — those play back inconsistently or not at
    all in many players. Re-encode to H.264 if the source isn't already,
    otherwise leave it untouched (fast path for the common case).
    """
    codec = get_video_codec(path)
    if codec == "h264":
        return path
    path = Path(path)
    dst = path.with_name(path.stem + "_h264.mp4")
    w, h = get_dimensions(path)
    w += w % 2; h += h % 2
    try:
        log_proc(proc_id, f"Source is {codec or 'unknown'} — converting to H.264 for compatibility...")
        _normalize_single(proc_id, str(path), str(dst), gpu, quiet=True, target_w=w, target_h=h)
        path.unlink(missing_ok=True)
        return dst
    except Exception:
        safe_delete(dst)
        return path


def run_combine(proc_id, video_paths, output_path, gpu, input_paths_to_delete_after, mute_flags=None):
    """
    Combine/normalize videos then delete ALL source inputs.
    input_paths_to_delete_after = list of paths that are safe to delete once done.
    mute_flags = list of bools parallel to video_paths — True silences that
    clip's audio in the final output while the rest keep their sound (e.g. an
    Instagram clip with royalty-free music that can't go into the submission).
    """
    upd_proc(proc_id, status="running", progress=5)
    log_proc(proc_id, f"Processing {len(video_paths)} video(s)...")
    tmp_dir = Path(output_path).parent / f"_tmp_{proc_id}"
    tmp_dir.mkdir(exist_ok=True)
    if not mute_flags or len(mute_flags) != len(video_paths):
        mute_flags = [False] * len(video_paths)

    try:
        if len(video_paths)==1:
            # Single file — skip re-encoding only if it's already H.264 AND
            # doesn't need muting (covers uploads; downloads are already
            # guaranteed H.264 by _ensure_h264 at download time, so this is
            # normally a fast no-op when no mute is requested).
            src = video_paths[0]
            mute = mute_flags[0]
            if get_video_codec(src) == "h264" and not mute:
                log_proc(proc_id,"Single file — already H.264, skipping normalization...")
                shutil.copy2(src, output_path)
            else:
                reason = "muting audio" if mute else "not H.264, converting for compatibility"
                log_proc(proc_id,f"Single file — {reason}...")
                w, h = get_dimensions(src)
                w += w % 2; h += h % 2
                _normalize_single(proc_id, src, str(output_path), gpu, quiet=False, target_w=w, target_h=h, mute=mute)
        else:
            # Find canvas: max width and max height across all clips
            log_proc(proc_id, "Scanning clip dimensions...")
            dims = []
            for vp in video_paths:
                w, h = get_dimensions(vp)
                dims.append((w, h))
                log_proc(proc_id, f"  {Path(vp).name}: {w}x{h}")

            canvas_w = max(d[0] for d in dims)
            canvas_h = max(d[1] for d in dims)
            # Must be even for H.264
            canvas_w += canvas_w % 2
            canvas_h += canvas_h % 2
            log_proc(proc_id, f"Canvas: {canvas_w}x{canvas_h} — each clip centered at native size")

            normalized=[]
            for i,(vp,(w,h)) in enumerate(zip(video_paths, dims)):
                clip_out = tmp_dir/f"clip_{i:03d}.mp4"
                mute = mute_flags[i]
                log_proc(proc_id,f"Clip {i+1}/{len(video_paths)}: {Path(vp).name} ({w}x{h})"+(" [MUTED]" if mute else ""))
                upd_proc(proc_id,progress=5+int((i/len(video_paths))*55))
                _normalize_single(proc_id,vp,str(clip_out),gpu,quiet=True,
                                  target_w=canvas_w, target_h=canvas_h, mute=mute)
                normalized.append(str(clip_out.resolve()))

            # Write concat list — all clips now share same dimensions
            concat_list = tmp_dir / "concat.txt"
            lines = ["file '" + p.replace(chr(92), "/") + "'" for p in normalized]
            concat_list.write_text("\n".join(lines))
            log_proc(proc_id, "Stitching...")
            upd_proc(proc_id, progress=65)
            r = subprocess.run(
                ["ffmpeg", "-y", "-f", "concat", "-safe", "0",
                 "-i", str(concat_list),
                 "-c", "copy", str(output_path)],
                capture_output=True, text=True, creationflags=_NO_WINDOW
            )
            if r.returncode!=0: raise RuntimeError(r.stderr[-600:])

        upd_proc(proc_id,progress=95)
        vi=get_video_info(output_path)
        upd_proc(proc_id,status="done",progress=100,
                 output_path=str(output_path),
                 file_size=vi["size_bytes"],duration_s=vi["duration_s"],
                 needs_compress=vi["size_bytes"]>SIZE_LIMIT_BYTES)
        log_proc(proc_id,f"Done — {vi['size_bytes']/1024/1024:.1f} MB")

        # ── DELETE all source inputs (downloads + uploads) ──
        for p in input_paths_to_delete_after:
            safe_delete(p)
        log_proc(proc_id,"Source files cleaned up.")

    except Exception as e:
        upd_proc(proc_id,status="error")
        log_proc(proc_id,f"Error: {e}")
    finally:
        shutil.rmtree(tmp_dir,ignore_errors=True)

# ══════════════════════════════════════════════════════════════════════════════
# COMPRESS
# Two-pass bitrate targeting — mimics HandBrake's ABR workflow:
#   1. Calculate exact video bitrate to hit TARGET_SIZE_BYTES
#   2. Pass 1: analysis-only scan (writes .log + .log.mbtree sidecar files)
#   3. Pass 2: encode using the stats from pass 1
#   4. Verify final size; if still over limit, retry from original source
#
# Key differences from a naive two-pass:
#   - ffmpeg writes progress to stderr using \r (carriage return), NOT \n.
#     Reading line-by-line with for-line-in-stdout blocks until \n which may
#     never come on Windows. We read raw chunks and split on both \r and \n.
#   - passlogfile must use a short path with NO spaces — ffmpeg's libx264
#     passes this path to the C library which can't handle quoted paths.
#     We use a fixed name inside the project temp dir (already short UUIDs).
#   - On Windows, pass 1 null output must be the literal string "NUL" as a
#     separate list element (not "-f null NUL" as one string).
#   - preset is now respected and forwarded to every ffmpeg call.
#   - The retry always encodes from original_src, never from the already-
#     compressed intermediate (avoids double-generation quality loss).
# ══════════════════════════════════════════════════════════════════════════════

TARGET_SIZE_BYTES = 380 * 1024 * 1024   # 380 MB target — 70 MB headroom under 450 MB
SIZE_LIMIT_BYTES  = 450 * 1024 * 1024   # hard limit

def _pick_audio_bps(duration, target_bytes):
    """
    Choose the highest audio bitrate that still leaves enough room for a
    usable video bitrate, given the target file size and duration.

    For short videos (< ~1hr) we use 192kbps stereo — broadcast quality.
    For long videos we step down through standard AAC bitrates so audio
    doesn't consume the entire budget.  Below 96kbps we switch to mono
    in _two_pass, which is fine for speech/ambient legal recordings.

    Standard AAC ladder (highest to lowest):
      192kbps stereo → 128kbps stereo → 96kbps stereo →
      64kbps mono → 32kbps mono
    """
    MIN_VIDEO_BPS = 80_000   # absolute floor — below this quality is unusable
    for abps in [192_000, 128_000, 96_000, 64_000, 32_000]:
        audio_bytes = abps * duration / 8
        video_bits  = (target_bytes - audio_bytes) * 8
        video_bps   = video_bits / duration
        if video_bps >= MIN_VIDEO_BPS:
            return abps, int(video_bps)
    # Even 32kbps audio leaves no room — just return minimum and let ffmpeg try
    audio_bytes = 32_000 * duration / 8
    video_bps   = max(MIN_VIDEO_BPS, int((target_bytes - audio_bytes) * 8 / duration))
    return 32_000, video_bps

def _build_vf(scale, pix_fmt):
    parts = []
    if scale:
        parts.append(f"scale={scale}")
    parts.append(f"format={pix_fmt}")
    return ",".join(parts)

def _run_ffmpeg(proc_id, args, duration, progress_start, progress_end):
    """
    Run an ffmpeg command, stream its output to the proc log, and update
    progress. Returns the process returncode.

    Critical implementation notes:
    - ffmpeg writes ALL output to stderr, not stdout.
    - Progress lines use \\r (carriage return) to overwrite the same console
      line, so they do NOT end with \\n. Reading with 'for line in proc.stdout'
      will block waiting for a \\n that never comes on many Windows builds.
    - We use stderr=subprocess.PIPE and read in raw chunks, splitting on both
      \\r and \\n, so we catch every progress update immediately.
    - stdout is suppressed (DEVNULL) since ffmpeg doesn't use it.
    """
    proc = subprocess.Popen(
        args,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        creationflags=_NO_WINDOW,
    )
    buf = ""
    while True:
        chunk = proc.stderr.read(256)
        if not chunk:
            break
        buf += chunk
        # Split on both \r and \n so progress lines are caught immediately
        parts = re.split(r'[\r\n]', buf)
        buf = parts[-1]          # keep any incomplete trailing fragment
        for line in parts[:-1]:
            line = line.strip()
            if not line:
                continue
            with state_lock:
                if proc_id in proc_jobs:
                    proc_jobs[proc_id]["log"].append(line)
            if duration and "time=" in line:
                try:
                    t = line.split("time=")[1].split()[0]
                    h, m, s = t.split(":")
                    elapsed = int(h)*3600 + int(m)*60 + float(s)
                    pct = progress_start + int(
                        (elapsed / duration) * (progress_end - progress_start)
                    )
                    upd_proc(proc_id, progress=min(progress_end, pct))
                except Exception:
                    pass
    proc.wait()
    return proc.returncode


def _two_pass(proc_id, src, vf, video_bps, audio_bps, preset, passlog, out_path,
              prog_a, prog_b, prog_c, duration):
    """
    Run a full two-pass encode.  Splits the progress range into two halves.
    Returns (rc, error_msg) — rc==0 means success.

    audio_bps is passed explicitly so the caller can reduce it for long videos
    where 192kbps audio alone would exceed the size target.

    passlog must be a path with NO spaces (libx264 passes it straight to C).
    On Windows the null sink for pass 1 must be 'NUL' (not '/dev/null').
    """
    null_sink = "NUL" if os.name == "nt" else "/dev/null"
    # For very long videos, mono audio saves space with no meaningful quality
    # loss for speech/ambient content. Switch to mono below 96kbps.
    audio_channels = "1" if audio_bps < 96_000 else "2"

    p1 = [
        "ffmpeg", "-y", "-i", str(src),
        "-vf", vf,
        "-c:v", "libx264",
        "-b:v", f"{video_bps}",
        "-pass", "1",
        "-passlogfile", passlog,
        "-preset", preset,
        "-an",                    # no audio in analysis pass
        "-f", "null", null_sink,
    ]
    log_proc(proc_id, "Pass 1/2 — analysing...")
    rc = _run_ffmpeg(proc_id, p1, duration, prog_a, prog_b)
    if rc != 0:
        return rc, "Pass 1 failed — see log above"

    p2 = [
        "ffmpeg", "-y", "-i", str(src),
        "-vf", vf,
        "-c:v", "libx264",
        "-b:v", f"{video_bps}",
        "-pass", "2",
        "-passlogfile", passlog,
        "-preset", preset,
        "-c:a", "aac",
        "-ac", audio_channels,
        "-ar", "48000",
        "-b:a", f"{audio_bps//1000}k",
        "-movflags", "+faststart",
        str(out_path),
    ]
    log_proc(proc_id, "Pass 2/2 — encoding...")
    rc = _run_ffmpeg(proc_id, p2, duration, prog_b, prog_c)
    if rc != 0:
        return rc, "Pass 2 failed — see log above"
    return 0, ""


def run_compress(proc_id, src, output_path, quality, delete_src_after=True, scale="", fast=False):
    upd_proc(proc_id, status="running", progress=5)
    log_proc(proc_id, "Compressing...")

    vi       = get_video_info(src)
    duration = vi.get("duration_s", 0)
    preset   = "veryfast" if fast else "medium"
    vf       = _build_vf(scale, "yuv420p")

    # passlogfile must live in the same dir as output and must have no spaces
    # in its path.  libx264's internal fopen() doesn't handle quoted paths.
    passlog_base = str(Path(output_path).parent / "p2log")

    # Save original source path before anything gets deleted
    original_src = str(src)

    try:
        if duration > 1:
            # ── Dynamic audio + video bitrate calculation ─────────────────────
            # For long videos, 192kbps audio alone can exceed the entire target.
            # _pick_audio_bps steps down through the AAC bitrate ladder to find
            # the highest audio quality that still leaves a usable video bitrate.
            audio_bps, video_bps = _pick_audio_bps(duration, TARGET_SIZE_BYTES)
            audio_ch = "mono" if audio_bps < 96_000 else "stereo"

            log_proc(proc_id,
                     f"Duration: {duration:.0f}s ({duration/3600:.2f}hr)  |  "
                     f"Target: {TARGET_SIZE_BYTES//1024//1024} MB  |  "
                     f"Video: {video_bps//1000} kbps  |  "
                     f"Audio: {audio_bps//1000} kbps {audio_ch}  |  "
                     f"Preset: {preset}")
            upd_proc(proc_id, progress=8)

            rc, err = _two_pass(
                proc_id, original_src, vf, video_bps, audio_bps, preset,
                passlog_base, str(output_path),
                8, 50, 96, duration
            )

            # Clean up passlog sidecar files regardless of success/failure
            for f in Path(output_path).parent.glob("p2log*"):
                safe_delete(f)

            if rc != 0:
                raise RuntimeError(err)

            # ── Verify final size ─────────────────────────────────────────────
            actual = Path(output_path).stat().st_size if Path(output_path).exists() else 0
            log_proc(proc_id, f"Output: {actual/1024/1024:.1f} MB")

            if actual > SIZE_LIMIT_BYTES:
                # File still over limit. Recalculate bitrates targeting even
                # smaller — scale proportionally with a safety margin, then
                # re-run _pick_audio_bps against that lower target.
                scale_ratio   = TARGET_SIZE_BYTES / actual
                tighter_target = int(TARGET_SIZE_BYTES * scale_ratio * 0.90)
                audio_bps2, video_bps2 = _pick_audio_bps(duration, tighter_target)
                log_proc(proc_id,
                         f"Over limit — retrying from original  |  "
                         f"Video: {video_bps2//1000} kbps  |  "
                         f"Audio: {audio_bps2//1000} kbps")

                if not Path(original_src).exists():
                    log_proc(proc_id,
                             "WARNING: original source already deleted — "
                             "cannot retry cleanly. Keeping current output.")
                else:
                    tmp_out       = str(output_path) + ".r2.mp4"
                    passlog_base2 = str(Path(output_path).parent / "p2log_r2")
                    rc2, err2 = _two_pass(
                        proc_id, original_src, vf, video_bps2, audio_bps2, preset,
                        passlog_base2, tmp_out,
                        8, 50, 96, duration
                    )
                    for f in Path(output_path).parent.glob("p2log_r2*"):
                        safe_delete(f)
                    if rc2 == 0 and Path(tmp_out).exists():
                        safe_delete(output_path)
                        Path(tmp_out).rename(output_path)
                        final_size = Path(output_path).stat().st_size
                        log_proc(proc_id, f"Retry done — {final_size/1024/1024:.1f} MB")
                    else:
                        safe_delete(tmp_out)
                        log_proc(proc_id, f"Retry failed: {err2} — keeping first pass output")

        else:
            # Duration unknown — fall back to CRF mode (very rare edge case)
            log_proc(proc_id, "Duration unknown — using CRF fallback (quality mode)...")
            p = [
                "ffmpeg", "-y", "-i", original_src,
                "-vf", vf,
                "-c:v", "libx264", "-crf", str(quality), "-preset", preset,
                "-c:a", "aac", "-ac", "2", "-ar", "48000", "-b:a", "128k",
                "-movflags", "+faststart",
                str(output_path),
            ]
            rc = _run_ffmpeg(proc_id, p, 0, 8, 99)
            if rc != 0:
                raise RuntimeError("CRF encode failed — see log")

        vi = get_video_info(output_path)
        upd_proc(proc_id, status="done", progress=100,
                 output_path=str(output_path), file_size=vi["size_bytes"])
        log_proc(proc_id, f"Done — {vi['size_bytes']/1024/1024:.1f} MB")
        if delete_src_after:
            safe_delete(src)
        log_proc(proc_id, "Intermediate file cleaned up.")

    except Exception as e:
        # Clean up any passlog files left behind on failure
        for f in Path(output_path).parent.glob("p2log*"):
            safe_delete(f)
        upd_proc(proc_id, status="error")
        log_proc(proc_id, f"Error: {e}")
# ══════════════════════════════════════════════════════════════════════════════
# FOLDER PICKER  (runs in main thread via tkinter)
# ══════════════════════════════════════════════════════════════════════════════

import queue as _queue
_picker_queue = _queue.Queue()   # Flask threads put requests here
# Each request is a (req_id, result_queue) tuple.
# tk_loop picks them up, opens the dialog, puts the result in result_queue.

def _tk_pick_folder():
    """Call from any Flask thread — safely opens a folder picker on the main thread."""
    result_q = _queue.Queue()
    _picker_queue.put(result_q)
    try:
        folder = result_q.get(timeout=60)  # wait up to 60s for user to pick
    except _queue.Empty:
        folder = None
    return folder or None

def _mac_force_foreground():
    """
    On macOS, a plain `python3` process (not a real .app bundle) doesn't get
    automatically brought to the front when it opens a window — the Dock just
    bounces the Python icon waiting for the user to click it. If the user
    clicks a folder in the dialog before it's actually frontmost, the click
    can land on whatever window IS in front, which reads as the picker
    "closing instantly and doing nothing." Force-activate our own process
    right before opening the dialog so it comes forward on its own.
    """
    if sys.platform != "darwin":
        return
    try:
        r = subprocess.run(
            ["osascript", "-e",
             f'tell application "System Events" to set frontmost of '
             f'(first process whose unix id is {os.getpid()}) to true'],
            capture_output=True, text=True, timeout=3,
        )
        if r.returncode != 0:
            print("  [folder picker] couldn't bring the window to the front "
                  "automatically. Look for a bouncing Python icon in the Dock "
                  "and click it before choosing a folder. To fix this "
                  "permanently: System Settings > Privacy & Security > "
                  "Automation > Terminal, and allow it to control "
                  f"'System Events'.  (detail: {r.stderr.strip()[:200]})")
    except Exception as e:
        print(f"  [folder picker] foreground-activation error: {e}")

def tk_loop():
    """Run in main thread. Serves folder-picker requests from Flask threads."""
    import tkinter as tk
    from tkinter import filedialog
    root = tk.Tk()
    root.withdraw()
    root.wm_attributes("-topmost", 1)
    try:
        while True:
            try:
                result_q = _picker_queue.get(timeout=0.2)
            except _queue.Empty:
                root.update()  # keep tkinter alive
                continue
            _mac_force_foreground()
            root.lift()
            root.focus_force()
            folder = filedialog.askdirectory(
                title="Choose save location",
                parent=root
            )
            result_q.put(folder or None)
    except KeyboardInterrupt:
        print("\nStopped.")
        sys.exit(0)

# ══════════════════════════════════════════════════════════════════════════════
# API ROUTES
# ══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index():
    here = Path(__file__).parent
    return send_from_directory(str(here / "ui"), "index.html")

@app.route("/lemon_preview.png")
def lemon_png():
    # Serve the lemon icon from the same directory as squeeze.py
    here = Path(__file__).parent
    return send_file(str(here / "lemon_preview.png"), mimetype="image/png")

@app.route("/api/status")
def api_status(): return jsonify({"ffmpeg":ffmpeg_ok(),"gpu":get_gpu(),"version":upd.current_version() if upd else ""})

@app.route("/api/version")
def api_version():
    # Deliberately tiny and dependency-free: the UI polls this after an update to know Squeeze is back.
    return jsonify({"version": upd.current_version() if upd else ""})

@app.route("/api/preview-metadata", methods=["POST"])
def api_preview_metadata():
    """
    Lightweight, read-only lookup (no download) so a video's real publication
    date can be seen before committing to a full fetch — reuses the same
    fetch_metadata_only() Rights Manager uses. Runs a few lookups at once
    since each is a real network round-trip to the platform.
    """
    data = request.get_json() or {}
    urls = [u.strip() for u in data.get("urls", []) if u.strip()][:25]  # sane cap
    if not urls:
        return jsonify({"results": []})
    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = [ex.submit(fetch_metadata_only, u) for u in urls]
        results = []
        for u, f in zip(urls, futures):
            try:
                meta = f.result()
            except Exception as e:
                meta = {"error": str(e)}
            results.append({
                "url": u,
                "date": meta.get("date",""),
                "title": meta.get("title",""),
                "platform": meta.get("platform") or detect_platform_from_url(u),
                "error": meta.get("error",""),
            })
    return jsonify({"results": results})

# ── Projects ──────────────────────────────────────────────────────────────────

@app.route("/api/projects")
def api_list_projects():
    with state_lock: return jsonify(list(projects.values()))

@app.route("/api/projects",methods=["POST"])
def api_create_project():
    data=request.get_json() or {}
    name=data.get("name","").strip()
    if not name: return jsonify({"error":"Name required"}),400
    client_name=data.get("client_name","").strip()
    pid=str(uuid.uuid4())[:8]
    p={"id":pid,"name":name,"client_name":client_name,"created":time.time(),"videos":[],"final_proc_id":None}
    with state_lock:
        projects[pid]=p; save_projects()
    project_dir(pid)
    return jsonify(p)

@app.route("/api/projects/<pid>/client-name",methods=["POST"])
def api_set_client_name(pid):
    data=request.get_json() or {}
    client_name=data.get("client_name","").strip()
    with state_lock:
        if pid not in projects: return jsonify({"error":"Not found"}),404
        projects[pid]["client_name"]=client_name
        save_projects()
    return jsonify({"ok":True,"client_name":client_name})

@app.route("/api/projects/<pid>")
def api_get_project(pid):
    with state_lock:
        p = projects.get(pid)
        if not p: return jsonify({"error":"Not found"}),404
        p = dict(p)  # shallow copy — don't mutate the stored record with the fields below
        # Surface anything still in flight for this project that hasn't been
        # saved into p["videos"] / marked done yet. This lets the client fully
        # reconstruct progress after switching to another project and back
        # (or even just reloading the page) from the backend's own state,
        # instead of relying on fragile client-only memory that gets thrown
        # away whenever the view re-renders.
        p["active_downloads"] = [
            {"id": j["id"], "url": j.get("url",""), "status": j["status"],
             "progress": j.get("progress",0), "speed": j.get("speed","")}
            for j in dl_jobs.values()
            if j.get("project_id") == pid and j.get("status") in ("queued","running")
        ]
        # Also surface the most recent combine/compress job regardless of its
        # status — "running" so the client can resume polling instead of
        # showing nothing, and "done"/"error" so it can jump straight to the
        # right unlocked step instead of looking like that work never happened.
        p["active_proc"] = None
        proc_id = p.get("final_proc_id")
        if proc_id and proc_id in proc_jobs:
            pj = dict(proc_jobs[proc_id])
            pj.pop("log", None)  # keep the payload light; not needed to restore UI state
            p["active_proc"] = pj
    return jsonify(p)

@app.route("/api/projects/<pid>",methods=["DELETE"])
def api_delete_project(pid):
    wipe_project_work(pid)
    return jsonify({"ok":True})

@app.route("/api/projects/<pid>/videos/<vid_id>",methods=["DELETE"])
def api_delete_video(pid,vid_id):
    with state_lock:
        p=projects.get(pid)
        if not p: return jsonify({"error":"Not found"}),404
        vid=[v for v in p["videos"] if v["id"]==vid_id]
        p["videos"]=[v for v in p["videos"] if v["id"]!=vid_id]
        save_projects()
    # Also delete the file on disk
    for v in vid: safe_delete(v.get("path",""))
    return jsonify({"ok":True})

# ── Downloads ─────────────────────────────────────────────────────────────────

@app.route("/api/projects/<pid>/fetch",methods=["POST"])
def api_fetch(pid):
    with state_lock:
        if pid not in projects: return jsonify({"error":"Not found"}),404
    data=request.get_json() or {}
    urls=data.get("urls",[]); quality=data.get("quality","best")
    if not urls: return jsonify({"error":"No URLs"}),400
    dest=project_dir(pid); started=[]
    for url in urls:
        url=url.strip()
        if not url: continue
        dl_id=str(uuid.uuid4())[:8]
        with state_lock:
            dl_jobs[dl_id]={"id":dl_id,"project_id":pid,"url":url,
                "status":"queued","progress":0,"speed":"","log":[],
                "output_path":None,"filename":None,"file_size":None,
                "duration_s":None,"title":url,"platform":"","thumbnail":"","date":"",
                "width":0,"height":0}
        threading.Thread(target=run_download,args=(dl_id,url,quality,dest),daemon=True).start()
        started.append(dl_id)
    return jsonify({"dl_ids":started})

@app.route("/api/dl/<dl_id>")
def api_dl_status(dl_id):
    with state_lock: j=dl_jobs.get(dl_id)
    if not j: return jsonify({"error":"Not found"}),404
    return jsonify({k:v for k,v in j.items() if k!="log"}|{"log_tail":j["log"][-4:]})

@app.route("/api/dl/<dl_id>/download")
def api_dl_download(dl_id):
    with state_lock: j=dl_jobs.get(dl_id)
    if not j or j["status"]!="done": return jsonify({"error":"Not ready"}),404
    out=Path(j["output_path"])
    if not out.exists(): return jsonify({"error":"File missing"}),404
    return send_file(out,as_attachment=True,download_name=j["filename"])

# ── Upload ────────────────────────────────────────────────────────────────────

@app.route("/api/projects/<pid>/upload",methods=["POST"])
def api_upload(pid):
    with state_lock:
        if pid not in projects: return jsonify({"error":"Not found"}),404
    if "file" not in request.files: return jsonify({"error":"No file"}),400
    f=request.files["file"]
    vid_id=str(uuid.uuid4())[:8]
    ext=Path(f.filename).suffix or ".mp4"
    dest=project_dir(pid)/f"{vid_id}{ext}"
    f.save(dest)
    vi=get_video_info(dest)
    entry={"id":vid_id,"type":"upload","path":str(dest),"filename":f.filename,
           "title":f.filename,"platform":"upload","thumbnail":"",
           "size_bytes":vi["size_bytes"],"duration_s":vi["duration_s"],
           "width":vi["width"],"height":vi["height"],"url":""}
    with state_lock:
        projects[pid]["videos"].append(entry); save_projects()
    return jsonify(entry)

# ── Combine ───────────────────────────────────────────────────────────────────

@app.route("/api/projects/<pid>/combine",methods=["POST"])
def api_combine(pid):
    with state_lock:
        p=projects.get(pid)
        if not p: return jsonify({"error":"Not found"}),404
    data=request.get_json() or {}
    vid_ids=data.get("video_ids") or [v["id"] for v in p["videos"]]
    muted_ids=set(data.get("muted_ids") or [])
    gpu=get_gpu()
    vid_map={v["id"]:v for v in p["videos"]}
    vids=[vid_map[i] for i in vid_ids if i in vid_map]
    paths=[v["path"] for v in vids]
    if not paths: return jsonify({"error":"No valid videos"}),400
    mute_flags=[v["id"] in muted_ids for v in vids]  # parallel to paths/vids, same order

    proc_id=str(uuid.uuid4())[:8]
    out=project_dir(pid)/f"combined_{proc_id}.mp4"
    # After combine, delete the source files
    paths_to_delete=[v["path"] for v in vids]

    with state_lock:
        proc_jobs[proc_id]={"id":proc_id,"type":"combine","project_id":pid,
            "status":"queued","progress":0,"log":[],
            "output_path":None,"file_size":None,"duration_s":None,"needs_compress":False}
        # Track the active job on the project itself so switching away and
        # back (or reloading) can restore "still working" instead of losing it.
        projects[pid]["final_proc_id"]=proc_id
        save_projects()
    threading.Thread(target=run_combine,
                     args=(proc_id,paths,str(out),gpu,paths_to_delete,mute_flags),daemon=True).start()
    return jsonify({"proc_id":proc_id})

# ── Compress ──────────────────────────────────────────────────────────────────

def run_copy(proc_id, src, output_path):
    """Stream copy — no re-encode, instant. Just gives the file a proc_id for export."""
    upd_proc(proc_id, status="running", progress=50)
    log_proc(proc_id, "Stream copying (no re-encode)...")
    try:
        shutil.copy2(str(src), str(output_path))
        vi = get_video_info(output_path)
        upd_proc(proc_id, status="done", progress=100,
                 output_path=str(output_path), file_size=vi["size_bytes"])
        log_proc(proc_id, f"Done — {vi['size_bytes']/1024/1024:.1f} MB")
        # Delete the source if it differs from the output (i.e. it's an intermediate)
        if Path(src).resolve() != Path(output_path).resolve():
            safe_delete(src)
            log_proc(proc_id, "Source intermediate cleaned up.")
    except Exception as e:
        upd_proc(proc_id, status="error")
        log_proc(proc_id, f"Error: {e}")

@app.route("/api/projects/<pid>/compress",methods=["POST"])
def api_compress(pid):
    with state_lock:
        p=projects.get(pid)
        if not p: return jsonify({"error":"Not found"}),404
    data=request.get_json() or {}
    src=data.get("source_path",""); quality=int(data.get("quality",28))
    copy_only=data.get("copy_only",False)
    scale=data.get("scale","")        # e.g. "1280:-2" for 720p, "854:-2" for 480p
    fast=data.get("fast",False)
    if not src or not Path(src).exists(): return jsonify({"error":"Source not found"}),400
    # Skip compression for files under 450 MB — just stream copy
    if not copy_only and Path(src).stat().st_size <= SIZE_LIMIT_BYTES:
        copy_only = True
    proc_id=str(uuid.uuid4())[:8]
    out=project_dir(pid)/f"final_{proc_id}.mp4"
    with state_lock:
        proc_jobs[proc_id]={"id":proc_id,"type":"compress","project_id":pid,
            "status":"queued","progress":0,"log":[],"output_path":None,"file_size":None}
        projects[pid]["final_proc_id"]=proc_id
        save_projects()
    if copy_only:
        threading.Thread(target=run_copy,
                         args=(proc_id,src,str(out)),daemon=True).start()
    else:
        threading.Thread(target=run_compress,
                         args=(proc_id,src,str(out),quality,False,scale,fast),daemon=True).start()
    return jsonify({"proc_id":proc_id})

# ── Proc status ───────────────────────────────────────────────────────────────

@app.route("/api/proc/<proc_id>")
def api_proc_status(proc_id):
    with state_lock: j=proc_jobs.get(proc_id)
    if not j: return jsonify({"error":"Not found"}),404
    return jsonify({k:v for k,v in j.items() if k!="log"}|{"log_tail":j["log"][-5:]})

# ── Batch processing ─────────────────────────────────────────────────────────

batch_jobs = {}   # { batch_id: { status, items: [{url, project_id, status, ...}], save_folder } }
batch_lock = threading.Lock()

def run_batch(batch_id):
    with batch_lock:
        job = batch_jobs[batch_id]
    items = job["items"]
    save_folder = Path(job["save_folder"])
    for i, item in enumerate(items):
        with batch_lock:
            batch_jobs[batch_id]["current"] = i
            item["status"] = "downloading"

        # 1. Create project
        pid = str(uuid.uuid4())[:8]
        pname = item["name"]
        with state_lock:
            projects[pid] = {"id":pid,"name":pname,"created":time.time(),"videos":[],"final_proc_id":None}
            save_projects()
        project_dir(pid)

        # 2. Download
        dl_id = str(uuid.uuid4())[:8]
        with state_lock:
            dl_jobs[dl_id] = {"id":dl_id,"project_id":pid,"url":item["url"],
                "status":"queued","progress":0,"speed":"","log":[],
                "output_path":None,"filename":None,"file_size":None,
                "duration_s":None,"title":item["url"],"platform":"","thumbnail":"","date":"",
                "width":0,"height":0}
        run_download(dl_id, item["url"], item.get("quality","best"), project_dir(pid))

        with state_lock:
            dl = dl_jobs[dl_id]

        if dl["status"] != "done":
            with batch_lock:
                item["status"] = "error"
                item["error"] = "Download failed"
            wipe_project_work(pid)
            continue

        src = dl["output_path"]
        file_size = dl["file_size"] or 0

        with batch_lock:
            item["status"] = "compressing" if file_size > SIZE_LIMIT_BYTES else "saving"
            item["file_size"] = dl["file_size"]
            item["title"] = dl.get("title", pname)

        # 3. Compress if over 450MB
        if file_size > SIZE_LIMIT_BYTES:
            proc_id = str(uuid.uuid4())[:8]
            out = project_dir(pid) / f"final_{proc_id}.mp4"
            with state_lock:
                proc_jobs[proc_id] = {"id":proc_id,"type":"compress","project_id":pid,
                    "status":"queued","progress":0,"log":[],"output_path":None,"file_size":None}
            scale = item.get("scale","1280:-2")
            fast = item.get("fast", True)
            run_compress(proc_id, src, str(out), 28, True, scale, fast)
            with state_lock:
                pj = proc_jobs[proc_id]
            if pj["status"] != "done":
                with batch_lock:
                    item["status"] = "error"
                    item["error"] = "Compression failed"
                wipe_project_work(pid)
                continue
            final = Path(pj["output_path"])
            final_size = pj["file_size"]
        else:
            final = Path(src)
            final_size = file_size

        # 4. Save to folder — "Name - Date - Title", same shared helper and
        # convention as everywhere else in the app. The item's own name
        # field is the "Name" here since Batch has no separate client-name
        # concept; date/title come from what the download actually reported.
        safe_name = build_rights_filename(pname, dl.get("date",""), dl.get("title") or pname, ".mp4")
        with _rights_filename_lock:
            safe_name = reserve_unique_filename(save_folder, safe_name, set())
        dest = save_folder / safe_name
        try:
            shutil.copy2(str(final), str(dest))
        except Exception as e:
            with batch_lock:
                item["status"] = "error"
                item["error"] = f"Save failed: {e}"
            wipe_project_work(pid)
            continue

        # 5. Cleanup
        wipe_project_work(pid)

        with batch_lock:
            item["status"] = "done"
            item["saved_to"] = str(dest)
            item["final_size"] = final_size
            batch_jobs[batch_id]["completed"] = batch_jobs[batch_id].get("completed",0) + 1

    with batch_lock:
        batch_jobs[batch_id]["status"] = "done"


@app.route("/api/batch/start", methods=["POST"])
def api_batch_start():
    data = request.get_json() or {}
    items = data.get("items", [])   # [{url, name, quality, scale, fast}]
    save_folder = data.get("save_folder", "")
    if not items: return jsonify({"error":"No items"}), 400
    if not save_folder: return jsonify({"error":"No save folder"}), 400
    Path(save_folder).mkdir(parents=True, exist_ok=True)

    batch_id = str(uuid.uuid4())[:8]
    with batch_lock:
        batch_jobs[batch_id] = {
            "id": batch_id,
            "status": "running",
            "save_folder": save_folder,
            "current": 0,
            "completed": 0,
            "items": [{"url":it["url"],"name":it.get("name","Untitled"),
                       "quality":it.get("quality","best"),
                       "scale":it.get("scale","1280:-2"),
                       "fast":it.get("fast",True),
                       "status":"queued","file_size":None,
                       "final_size":None,"saved_to":None,"error":None,"title":None}
                      for it in items]
        }
    threading.Thread(target=run_batch, args=(batch_id,), daemon=True).start()
    return jsonify({"batch_id": batch_id})


@app.route("/api/batch/<batch_id>")
def api_batch_status(batch_id):
    with batch_lock:
        j = batch_jobs.get(batch_id)
    if not j: return jsonify({"error":"Not found"}), 404
    return jsonify(j)


@app.route("/api/batch/pick-folder", methods=["POST"])
def api_batch_pick_folder():
    folder = _tk_pick_folder()
    if not folder: return jsonify({"cancelled": True})
    return jsonify({"folder": folder})


# ── Export — pick folder, copy final file there, wipe work dir ────────────────

@app.route("/api/proc/<proc_id>/export",methods=["POST"])
def api_export(proc_id):
    with state_lock: j=proc_jobs.get(proc_id)
    if not j or j["status"]!="done": return jsonify({"error":"Not ready"}),404
    final=Path(j["output_path"])
    if not final.exists(): return jsonify({"error":"File missing"}),404

    pid=j.get("project_id","")
    proj=projects.get(pid,{})
    pname=proj.get("name","project")
    # "Client Name - Date - Title" — same shared helper Rights Manager uses,
    # so naming is consistent everywhere in the app. Client name falls back
    # to the project name if she hasn't set one; date/title come from the
    # single source video when there is one, otherwise (a combined multi-
    # video export) there's no single video date/title to use, so the
    # earliest clip's date and the project name stand in for those parts.
    client_name=proj.get("client_name") or pname
    videos=proj.get("videos",[])
    if len(videos)==1:
        date=videos[0].get("date","")
        title=videos[0].get("title") or pname
    else:
        dates=[v.get("date") for v in videos if v.get("date")]
        date=min(dates) if dates else ""
        title=pname
    fname=build_rights_filename(client_name, date, title, ".mp4")

    # Open native folder picker
    folder=_tk_pick_folder()
    if not folder:
        return jsonify({"error":"cancelled"}),200

    with _rights_filename_lock:
        fname=reserve_unique_filename(folder, fname, set())
    dest=Path(folder)/fname

    try:
        shutil.copy2(str(final),str(dest))
    except Exception as e:
        return jsonify({"error":f"Copy failed: {e}"}),500

    # Wipe the entire project working directory — nothing left behind
    wipe_project_work(pid)

    return jsonify({"ok":True,"saved_to":str(dest),"filename":dest.name})

@app.route("/api/cleanup", methods=["POST"])
def api_cleanup():
    """
    Manually wipe ALL squeeze_work project subdirectories.
    Safe to call at any time — only removes intermediates, never the
    exported final file (which was already copied to the user's chosen folder).
    """
    wiped = []
    errors = []
    known_pids = set(projects.keys())
    for d in WORK_DIR.iterdir():
        if not d.is_dir():
            continue
        try:
            shutil.rmtree(d, ignore_errors=True)
            wiped.append(d.name)
        except Exception as e:
            errors.append(f"{d.name}: {e}")
    # Clear the projects index too — everything is gone
    with state_lock:
        projects.clear()
        save_projects()
    return jsonify({"wiped": wiped, "errors": errors})

# ══════════════════════════════════════════════════════════════════════════════
# RIGHTS MANAGER — independent workflow (CSV import → review → download)
#
# Deliberately separate from the Project and Batch workflows above:
#   - its own in-memory job store (rights_jobs) and lock (rights_lock)
#   - its own scratch directory (RIGHTS_WORK_DIR), never touched by
#     startup_cleanup()/api_cleanup() which only ever look inside WORK_DIR
#   - its own small concurrent worker pool coordinating independent calls to
#     run_download() — the existing sequential run_batch() is untouched
# Reused as-is from the rest of the app: run_download(), _ensure_h264()
# (inside it), get_video_codec(), _tk_pick_folder().
# ══════════════════════════════════════════════════════════════════════════════

rights_jobs = {}   # { batch_id: {status, rows:{row_id:{...}}, order:[row_id,...], ...} }
rights_lock = threading.Lock()
_rights_filename_lock = threading.Lock()   # guards dedupe-suffix filename reservation

RIGHTS_COLUMN_ALIASES = {
    "client":      ["client", "client name", "author", "creator"],
    "url":         ["url", "link", "video url", "post url", "source url"],
    "title":       ["title", "post title", "video title"],
    "description": ["description", "caption", "post description"],
    "date":        ["date", "date posted", "publication date", "published date", "posted at"],
    "platform":    ["platform", "source", "social platform"],
}

def _map_rights_columns(fieldnames):
    """Case-insensitive, whitespace-trimmed header matching against RIGHTS_COLUMN_ALIASES."""
    norm = {(h or "").strip().lower(): h for h in fieldnames}
    mapping = {}
    for canon, aliases in RIGHTS_COLUMN_ALIASES.items():
        for alias in aliases:
            if alias in norm:
                mapping[canon] = norm[alias]
                break
    return mapping

def _parse_rights_date(raw):
    """Parse a free-form CSV date into YYYY-MM-DD. Distinguishes blank (fine,
    metadata may fill it in later) from present-but-unparseable (a real error)."""
    raw = (raw or "").strip()
    if not raw:
        return {"value": "", "valid": True, "blank": True}
    try:
        dt = dateutil_parser.parse(raw, fuzzy=False)
        return {"value": dt.strftime("%Y-%m-%d"), "valid": True, "blank": False}
    except Exception:
        return {"value": raw, "valid": False, "blank": False}

_rights_extractor_cache = None
def detect_platform_from_url(url):
    """
    Pure local URL-pattern matching against yt-dlp's extractor list — no
    network call. Returns '' if nothing but the generic fallback extractor
    matches, which we treat as 'unrecognized platform'.
    """
    global _rights_extractor_cache
    if not url:
        return ""
    try:
        if _rights_extractor_cache is None:
            from yt_dlp.extractor import gen_extractor_classes
            _rights_extractor_cache = [ie for ie in gen_extractor_classes()
                                        if ie.IE_NAME.lower() != "generic"]
        for ie in _rights_extractor_cache:
            try:
                if ie.suitable(url):
                    return ie.IE_NAME
            except Exception:
                continue
    except Exception:
        pass
    return ""

def fetch_metadata_only(url):
    """
    Read-only metadata lookup (no download) — used only to fill CSV gaps,
    never to overwrite a value the CSV already provided.
    """
    try:
        opts = {"quiet": True, "no_warnings": True, "skip_download": True}
        cookie_browser = _detect_cookie_browser()
        if cookie_browser:
            opts["cookiesfrombrowser"] = (cookie_browser,)
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
        return {
            "title": info.get("title") or "",
            "description": info.get("description") or "",
            "date": _yt_date_to_iso(info.get("upload_date")),
            "platform": info.get("extractor_key") or "",
            "source_id": info.get("id") or "",
        }
    except Exception as e:
        return {"error": str(e)}

# ── Filename helper — the ONE place Rights Manager filenames are built ─────────

_WINDOWS_RESERVED_NAMES = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}

def _sanitize_filename_part(s):
    s = s or ""
    s = re.sub(r'[\r\n]+', ' ', s)          # remove line breaks
    s = re.sub(r'[<>:"/\\|?*]', '', s)      # strip characters illegal on Windows (macOS's illegal set is a subset)
    s = re.sub(r'\s+', ' ', s).strip()      # collapse whitespace, trim ends
    s = s.rstrip('. ')                       # trailing periods/spaces break Windows paths
    return s

def build_rights_filename(client, date_str, title_or_desc, ext, max_len=180):
    """
    Client Name - Date Posted - Post Title or Description.ext
    Windows- and macOS-safe. Truncates the title first if needed, always
    preserving the client name and date in full.
    """
    client = _sanitize_filename_part(client) or "Unknown Client"
    date_str = _sanitize_filename_part(date_str) or "Unknown Date"
    title = _sanitize_filename_part(title_or_desc) or "Untitled"
    ext = ext if ext.startswith(".") else f".{ext}"
    ext = ext.lower()

    prefix = f"{client} - {date_str} - "
    room = max(10, max_len - len(prefix) - len(ext))
    if len(title) > room:
        title = title[:room].rstrip()

    stem = f"{prefix}{title}".rstrip('. ')
    if stem.upper() in _WINDOWS_RESERVED_NAMES:
        stem = f"_{stem}"
    return f"{stem}{ext}"

def reserve_unique_filename(folder, filename, claimed):
    """
    Avoid overwriting existing files or colliding with another row already
    claimed in this batch, adding ' (2)', ' (3)', ... as needed. `claimed` is
    a shared set mutated in place — caller must hold _rights_filename_lock.
    """
    stem, ext = Path(filename).stem, Path(filename).suffix
    candidate = filename
    n = 2
    while (Path(folder) / candidate).exists() or candidate in claimed:
        candidate = f"{stem} ({n}){ext}"
        n += 1
    claimed.add(candidate)
    return candidate

# ── CSV row construction — shared by import-time parsing AND start-time re-validation ──

def _build_rights_row(row_number, url, client, title, description, platform, date_raw,
                       default_client, seen_urls):
    row_id = str(uuid.uuid4())[:8]
    url = (url or "").strip()
    client = (client or "").strip() or (default_client or "").strip()
    title = (title or "").strip()
    description = (description or "").strip()
    platform = (platform or "").strip()
    date_info = _parse_rights_date(date_raw)

    errors, warnings = [], []
    if not url:
        errors.append("Missing URL")
    if not client:
        errors.append("Missing client name")
    if not date_info["valid"]:
        errors.append(f"Invalid date format: '{date_info['value']}'")
    elif date_info["blank"]:
        warnings.append("No publication date in CSV — will try to fill in from the source")
    if not title and not description:
        warnings.append("No title or description in CSV — will use a platform/ID fallback name")

    detected_platform = platform or (detect_platform_from_url(url) if url else "")
    if url and not detected_platform:
        warnings.append("Unrecognized platform — download may not be supported")

    norm_url = url.lower()
    duplicate_of = None
    if norm_url:
        if norm_url in seen_urls:
            duplicate_of = seen_urls[norm_url]
            warnings.append("Duplicate URL — same as an earlier row")
        else:
            seen_urls[norm_url] = row_id

    status = "Needs Review" if errors else "Ready"
    preview_title = title or description or f"{detected_platform or 'Unknown'} {row_id}"
    proposed = "" if errors else build_rights_filename(client, date_info["value"], preview_title, ".mp4")

    return {
        "id": row_id, "row_number": row_number,
        "client": client, "platform": detected_platform, "date": date_info["value"],
        "title": title, "description": description, "url": url,
        "proposed_filename": proposed,
        "status": status, "errors": errors, "warnings": warnings,
        "duplicate_of": duplicate_of, "include": duplicate_of is None,
        "saved_to": None, "error": "",
    }

def parse_rights_csv(file_bytes, default_client=""):
    try:
        text = file_bytes.decode("utf-8-sig", errors="replace")
    except Exception as e:
        return {"error": f"Could not read file as text: {e}"}
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames:
        return {"error": "CSV appears to be empty or has no header row."}
    mapping = _map_rights_columns(reader.fieldnames)
    if "url" not in mapping:
        return {
            "error": "Could not find a URL column. Recognized names: url, link, video url, post url, source url.",
            "detected_columns": mapping, "csv_headers": reader.fieldnames,
        }

    seen_urls, rows = {}, []
    for i, raw in enumerate(reader):
        def get(col):
            key = mapping.get(col)
            return raw.get(key, "") if key else ""
        rows.append(_build_rights_row(
            row_number=i + 1, url=get("url"), client=get("client"),
            title=get("title"), description=get("description"),
            platform=get("platform"), date_raw=get("date"),
            default_client=default_client, seen_urls=seen_urls,
        ))
    return {"rows": rows, "detected_columns": mapping, "csv_headers": reader.fieldnames}

# ── Row processing — coordinates independent calls to run_download() ──────────

def _update_rights_row(batch_id, row_id, **kw):
    with rights_lock:
        job = rights_jobs.get(batch_id)
        if not job: return
        row = job["rows"].get(row_id)
        if not row: return
        row.update(kw)

def process_rights_row(batch_id, row_id):
    with rights_lock:
        job = rights_jobs.get(batch_id)
        if not job: return
        row = dict(job["rows"][row_id])   # local snapshot; writes go through _update_rights_row
        cancel_event = job["cancel_event"]

    if cancel_event.is_set():
        _update_rights_row(batch_id, row_id, status="Cancelled")
        return
    if not row.get("include", True):
        _update_rights_row(batch_id, row_id, status="Skipped")
        return

    scratch = RIGHTS_WORK_DIR / batch_id / row_id
    scratch.mkdir(parents=True, exist_ok=True)
    try:
        # ── Metadata supplement — fills ONLY the gaps the CSV left blank ──────
        needs_meta = (not row["date"]) or (not row["title"] and not row["description"]) or (not row["platform"])
        if needs_meta:
            _update_rights_row(batch_id, row_id, status="Fetching Metadata")
            meta = fetch_metadata_only(row["url"])
            if "error" not in meta:
                if not row["date"] and meta.get("date"):
                    row["date"] = meta["date"]
                if not row["title"] and not row["description"]:
                    if meta.get("title"): row["title"] = meta["title"]
                    elif meta.get("description"): row["description"] = meta["description"]
                if not row["platform"] and meta.get("platform"):
                    row["platform"] = meta["platform"]
                row["_source_id"] = meta.get("source_id", "")
            _update_rights_row(batch_id, row_id, date=row["date"], title=row["title"],
                                description=row["description"], platform=row["platform"])

        if cancel_event.is_set():
            _update_rights_row(batch_id, row_id, status="Cancelled")
            return

        # ── Download — reuses run_download() completely unmodified ───────────
        _update_rights_row(batch_id, row_id, status="Downloading")
        dl_id = f"rights_{row_id}"
        synthetic_pid = f"_rights_{batch_id}_{row_id}"   # never added to `projects`, so
                                                          # run_download's project-append no-ops
        with state_lock:
            dl_jobs[dl_id] = {"id": dl_id, "project_id": synthetic_pid, "url": row["url"],
                "status": "queued", "progress": 0, "speed": "", "log": [],
                "output_path": None, "filename": None, "file_size": None,
                "duration_s": None, "title": row["url"], "platform": "", "thumbnail": "",
                "width": 0, "height": 0}
        run_download(dl_id, row["url"], "best", scratch)
        with state_lock:
            dl = dict(dl_jobs.get(dl_id, {}))
            dl_jobs.pop(dl_id, None)   # don't let this accumulate across a long CSV run

        if dl.get("status") != "done":
            raise RuntimeError((dl.get("log") or ["Download failed"])[-1])

        # ── Rename into the chosen output folder ──────────────────────────────
        _update_rights_row(batch_id, row_id, status="Renaming")
        src = Path(dl["output_path"])
        ext = src.suffix or ".mp4"
        title_or_desc = row["title"] or row["description"] or f"{row['platform'] or 'Unknown'} {row.get('_source_id') or row_id}"
        base_name = build_rights_filename(row["client"], row["date"], title_or_desc, ext)

        with _rights_filename_lock:
            with rights_lock:
                claimed = rights_jobs[batch_id]["claimed_filenames"]
                out_folder = rights_jobs[batch_id]["output_folder"]
            final_name = reserve_unique_filename(out_folder, base_name, claimed)
            dest = Path(out_folder) / final_name
            shutil.move(str(src), str(dest))

        _update_rights_row(batch_id, row_id, status="Complete",
                            saved_to=str(dest), proposed_filename=dest.name, error="")
        with rights_lock:
            rights_jobs[batch_id]["completed"] += 1

    except Exception as e:
        _update_rights_row(batch_id, row_id, status="Failed", error=str(e))
        with rights_lock:
            rights_jobs[batch_id]["failed"] += 1
    finally:
        shutil.rmtree(scratch, ignore_errors=True)

def run_rights_batch(batch_id, row_ids):
    """Coordinate independent run_download() calls via a small thread pool."""
    with rights_lock:
        job = rights_jobs.get(batch_id)
        if not job: return
        job["status"] = "running"
        concurrency = max(1, min(int(job.get("concurrency", 3)), 8))

    with ThreadPoolExecutor(max_workers=concurrency) as ex:
        futures = [ex.submit(process_rights_row, batch_id, rid) for rid in row_ids]
        for f in futures:
            f.result()   # exceptions are already caught + recorded inside process_rights_row

    with rights_lock:
        job = rights_jobs.get(batch_id)
        if not job: return
        job["status"] = "done"
        skipped = sum(1 for rid in job["order"] if job["rows"][rid]["status"] == "Skipped")
        # Lightweight session log per spec — counts only, no URLs/titles/paths.
        print(f"  [Rights Manager] batch {batch_id} done — "
              f"{job['completed']} succeeded, {job['failed']} failed, {skipped} skipped "
              f"(CSV: {job['csv_filename']})")

    # Each row already cleaned up its own scratch subfolder; remove the now-empty
    # per-batch parent dir too so these don't accumulate across a day of imports.
    shutil.rmtree(RIGHTS_WORK_DIR / batch_id, ignore_errors=True)

# ── API routes ──────────────────────────────────────────────────────────────────

@app.route("/api/rights/import", methods=["POST"])
def api_rights_import():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    f = request.files["file"]
    default_client = (request.form.get("default_client") or "").strip()
    result = parse_rights_csv(f.read(), default_client)
    if "error" in result:
        return jsonify(result), 400

    batch_id = str(uuid.uuid4())[:8]
    rows = result["rows"]
    with rights_lock:
        rights_jobs[batch_id] = {
            "id": batch_id, "status": "reviewing",
            "csv_filename": f.filename or "import.csv",
            "imported_at": time.time(),
            "output_folder": "", "concurrency": 3,
            "order": [r["id"] for r in rows],
            "rows": {r["id"]: r for r in rows},
            "cancel_event": threading.Event(),
            "claimed_filenames": set(),
            "completed": 0, "failed": 0,
        }
    return jsonify({
        "batch_id": batch_id, "rows": rows,
        "detected_columns": result["detected_columns"], "csv_headers": result["csv_headers"],
    })

@app.route("/api/rights/<batch_id>/output-folder", methods=["POST"])
def api_rights_output_folder(batch_id):
    with rights_lock:
        if batch_id not in rights_jobs: return jsonify({"error": "Not found"}), 404
    folder = _tk_pick_folder()
    if not folder:
        return jsonify({"cancelled": True})
    with rights_lock:
        rights_jobs[batch_id]["output_folder"] = folder
    return jsonify({"folder": folder})

@app.route("/api/rights/<batch_id>/start", methods=["POST"])
def api_rights_start(batch_id):
    with rights_lock:
        job = rights_jobs.get(batch_id)
        if not job: return jsonify({"error": "Not found"}), 404

    data = request.get_json() or {}
    submitted_rows = data.get("rows")
    concurrency = data.get("concurrency", 3)
    output_folder = data.get("output_folder") or job["output_folder"]

    if not output_folder or not Path(output_folder).is_dir():
        return jsonify({"error": "Choose a valid output folder first"}), 400

    # Re-validate every submitted row server-side — the review table's own
    # validation is for instant UI feedback only, never trusted blindly here.
    if submitted_rows:
        seen_urls, rebuilt, order = {}, {}, []
        for r in submitted_rows:
            built = _build_rights_row(
                row_number=r.get("row_number", 0), url=r.get("url", ""),
                client=r.get("client", ""), title=r.get("title", ""),
                description=r.get("description", ""), platform=r.get("platform", ""),
                date_raw=r.get("date", ""), default_client="", seen_urls=seen_urls,
            )
            built["id"] = r.get("id") or built["id"]
            built["include"] = r.get("include", built["include"])
            rebuilt[built["id"]] = built
            order.append(built["id"])
        with rights_lock:
            job["rows"] = rebuilt
            job["order"] = order

    with rights_lock:
        job["output_folder"] = output_folder
        job["concurrency"] = max(1, min(int(concurrency), 8))
        includable = []
        for rid in job["order"]:
            row = job["rows"][rid]
            if not row.get("include", True):
                row["status"] = "Skipped"
            elif row["status"] == "Ready":
                row["status"] = "Queued"
                includable.append(rid)

    if not includable:
        return jsonify({"error": "No valid rows to download"}), 400

    threading.Thread(target=run_rights_batch, args=(batch_id, includable), daemon=True).start()
    return jsonify({"ok": True, "queued": len(includable)})

@app.route("/api/rights/<batch_id>")
def api_rights_status(batch_id):
    with rights_lock:
        job = rights_jobs.get(batch_id)
        if not job: return jsonify({"error": "Not found"}), 404
        rows = [job["rows"][rid] for rid in job["order"]]
        return jsonify({
            "id": batch_id, "status": job["status"],
            "total": len(rows), "completed": job["completed"], "failed": job["failed"],
            "skipped": sum(1 for r in rows if r["status"] == "Skipped"),
            "rows": rows,
            "session_log": {
                "import_timestamp": job["imported_at"],
                "csv_filename": job["csv_filename"],
                "total_rows": len(rows),
            },
        })

@app.route("/api/rights/<batch_id>/cancel", methods=["POST"])
def api_rights_cancel(batch_id):
    with rights_lock:
        job = rights_jobs.get(batch_id)
        if not job: return jsonify({"error": "Not found"}), 404
        job["cancel_event"].set()
    return jsonify({"ok": True})

@app.route("/api/rights/<batch_id>/retry-failed", methods=["POST"])
def api_rights_retry(batch_id):
    with rights_lock:
        job = rights_jobs.get(batch_id)
        if not job: return jsonify({"error": "Not found"}), 404
        job["cancel_event"] = threading.Event()
        failed_ids = [rid for rid in job["order"] if job["rows"][rid]["status"] == "Failed"]
        for rid in failed_ids:
            job["rows"][rid]["status"] = "Queued"
            job["rows"][rid]["error"] = ""

    if not failed_ids:
        return jsonify({"error": "No failed rows to retry"}), 400

    threading.Thread(target=run_rights_batch, args=(batch_id, failed_ids), daemon=True).start()
    return jsonify({"ok": True, "retrying": len(failed_ids)})

# ── Self-update ───────────────────────────────────────────────────────────────
# The banner in the UI drives these. Nothing here ever runs on its own: applying an update always
# starts from the user clicking "Update & restart".

@app.route("/api/update/status")
def api_update_status():
    if upd is None:
        return jsonify({"current": "", "available": False, "disabled": True})
    return jsonify(upd.status())

@app.route("/api/update/check", methods=["POST"])
def api_update_check():
    if upd is None:
        return jsonify({"error": "Self-update isn't available in this install."}), 501
    upd.check()  # synchronous: the user asked, so wait for the answer
    return jsonify(upd.status())

@app.route("/api/update/ack", methods=["POST"])
def api_update_ack():
    if upd is not None:
        upd.clear_last_result()
    return jsonify({"ok": True})

@app.route("/api/update/apply", methods=["POST"])
def api_update_apply():
    if upd is None:
        return jsonify({"error": "Self-update isn't available in this install."}), 501
    if _any_work_running():
        return jsonify({"error": "A download or encode is still running. Let it finish, then update."}), 409
    try:
        manifest = upd.stage_latest()      # downloads + verifies; changes nothing in the live install
    except upd.UpdateError as e:
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        return jsonify({"error": f"Update failed before anything was changed: {e}"}), 500
    try:
        upd.spawn_apply_helper(wait_pid=os.getpid())
    except Exception as e:
        return jsonify({"error": f"Couldn't start the update helper: {e}"}), 500
    # Answer first, then exit: the helper waits for this process to be gone before swapping files.
    threading.Timer(1.0, lambda: os._exit(0)).start()
    return jsonify({"ok": True, "restarting": True, "toVersion": manifest["version"]})

# ── Single-instance lock ───────────────────────────────────────────────────────

def _acquire_instance_lock():
    """
    Prevent multiple copies running at once using a socket-based lock.
    If another instance is already running, send it a shutdown signal first.
    """
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        sock.bind(("127.0.0.1", LOCK_PORT))  # lock port — one instance only
        sock.listen(1)
        return sock
    except OSError:
        print("  Another instance detected — shutting it down...")
        try:
            import urllib.request
            urllib.request.urlopen(f"http://127.0.0.1:{PORT}/api/shutdown", timeout=3)
        except Exception:
            pass
        time.sleep(2.5)
        try:
            sock2 = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock2.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock2.bind(("127.0.0.1", LOCK_PORT))
            sock2.listen(1)
            return sock2
        except OSError:
            print("  Could not claim lock — giving up.")
            sys.exit(1)

# ── Shutdown endpoint ──────────────────────────────────────────────────────────

@app.route("/api/shutdown", methods=["GET","POST"])
def api_shutdown():
    """Called by a new instance to cleanly kill this one."""
    threading.Thread(target=lambda: (time.sleep(0.5), os._exit(0)), daemon=True).start()
    return jsonify({"ok": True})

@app.route("/api/heartbeat", methods=["POST"])
def api_heartbeat():
    global _last_heartbeat
    _last_heartbeat = time.time()
    return jsonify({"ok": True})

def _any_job_active():
    """Return True if any download, combine, or compress job is currently running."""
    with state_lock:
        for j in dl_jobs.values():
            if j.get("status") in ("queued", "running"):
                return True
        for j in proc_jobs.values():
            if j.get("status") in ("queued", "running"):
                return True
    return False

def _any_work_running():
    """Broader than _any_job_active(): also counts a batch or Rights Manager run that is between
    two downloads (nothing 'running' at that instant, but the run is very much still going)."""
    if _any_job_active():
        return True
    with batch_lock:
        if any(j.get("status") == "running" for j in batch_jobs.values()):
            return True
    with rights_lock:
        if any(j.get("status") == "running" for j in rights_jobs.values()):
            return True
    return False

def _heartbeat_watchdog():
    """Shut down if the browser tab has been closed for more than _HEARTBEAT_TIMEOUT seconds,
    but only if no job is actively running."""
    global _last_heartbeat
    # Give the browser time to load before we start watching
    time.sleep(10)
    while True:
        time.sleep(5)
        if time.time() - _last_heartbeat > _HEARTBEAT_TIMEOUT:
            if _any_job_active():
                # A job is running — reset the clock and keep waiting
                _last_heartbeat = time.time()
                print("  Browser closed but job is active — staying alive...")
            else:
                print("\n  Browser closed — shutting down.")
                os._exit(0)

# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__=="__main__":
    _instance_lock = _acquire_instance_lock()  # must hold for lifetime of process
    load_projects()
    startup_cleanup()
    if not ffmpeg_ok():
        print("\n⚠  FFmpeg not found. Download: https://ffmpeg.org/download.html\n")
        input("Press Enter to exit..."); sys.exit(1)

    GPU_INFO=detect_gpu()
    print("\n"+"="*52)
    print("  SQUEEZE GPU v2 — Copyright Evidence Tool" + (f"  ({upd.current_version()})" if upd else ""))
    print("="*52)
    print(f"  GPU : {GPU_INFO['label']}")
    print(f"  H.264: {GPU_INFO['enc_h264']}")
    print("="*52)
    print(f"  http://localhost:{PORT}   (Ctrl+C to stop)")
    print("="*52+"\n")

    # Flask in background thread; tk folder-picker in main thread
    # NOTE: browser is opened by launcher.pyw — don't open it here too.
    flask_t=threading.Thread(
        target=lambda: app.run(host="127.0.0.1",port=PORT,debug=False,use_reloader=False),
        daemon=True)
    flask_t.start()

    # Watchdog: shut down automatically when browser tab is closed
    threading.Thread(target=_heartbeat_watchdog, daemon=True).start()

    # Look for a newer Squeeze in the background. Never blocks startup; a failure is just "no banner".
    if upd is not None:
        upd.check_async()

    tk_loop()   # blocks main thread, handles folder picker requests
