"""
SQUEEZE self-updater.

The Copyright Vault publishes each Squeeze release as a static ZIP plus a small manifest.json
(see squeeze/package.mjs). This module lets a running Squeeze notice a newer release, download it,
verify it, and swap its own files in -- after which it restarts. Nothing here ever runs without the
user clicking "Update & restart" in Squeeze's own banner.

Design rules (each one exists because the alternative can break someone's install):

  * Only code/UI/asset files can be replaced -- see is_updatable(). NEVER .bat / .command scripts
    (a batch file that is overwritten while cmd is still reading it corrupts itself mid-run), never
    the work folders, never squeeze_settings.json (the user's local overrides).
  * Every file is checked against the SHA-256 in the manifest, and every .py is compiled, BEFORE
    anything in the real install is touched.
  * The swap happens in a separate helper process after Squeeze has fully exited (so no file is
    ever replaced under a running program), with a backup taken first. Any failure rolls back.
  * Refuses to run while a download/encode is in progress, and never downgrades.

Trust note: HTTPS to the Vault plus a hash from the same origin protects against a corrupted or
truncated download -- it does not protect against a compromised Vault deployment, which would
control what every Squeeze installs. Treat the Vault's Cloudflare account as a code-signing key.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath

HERE = Path(__file__).resolve().parent

# Where releases are published. Overridable (env var for testing, settings file for a future move
# of the Vault to another address) so old installs are never stranded on a dead URL.
DEFAULT_MANIFEST_URL = "https://copyright-vault.alysonwalters22.workers.dev/tool-releases/squeeze/manifest.json"
SETTINGS_FILE = HERE / "squeeze_settings.json"

UPDATE_DIR = HERE / "_update"          # staging, backup, and result files -- always safe to delete
STAGED_DIR = UPDATE_DIR / "staged"
BACKUP_DIR = UPDATE_DIR / "backup"
DOWNLOAD_DIR = UPDATE_DIR / "download"
RESULT_FILE = UPDATE_DIR / "last_result.json"

MAX_MANIFEST_BYTES = 256 * 1024
MAX_ZIP_BYTES = 50 * 1024 * 1024
MAX_FILE_BYTES = 20 * 1024 * 1024
RECHECK_SECONDS = 30 * 60

# ---- What an update is allowed to touch -------------------------------------------------------
ALLOWED_SUFFIXES = {".py", ".pyw", ".html", ".css", ".js", ".png", ".ico", ".svg", ".txt", ".md"}
PROTECTED_TOP_LEVEL = {"squeeze_work", "squeeze_rights_work", "_update", "__pycache__"}
PROTECTED_NAMES = {"squeeze_settings.json"}
REQUIRED_FILES = ("squeeze.py", "squeeze_update.py", "launcher.pyw", "VERSION", "ui/index.html")


class UpdateError(Exception):
    """A problem worth showing to the user as-is (network, bad download, refusal)."""


def is_updatable(rel: str) -> bool:
    """True only for relative paths an update may create/replace. Deliberately a short allowlist of
    file *kinds* -- .bat/.command/.sh/.exe and anything outside the install folder are never one."""
    if not rel or "\\" in rel or ":" in rel or rel.startswith("/"):
        return False
    p = PurePosixPath(rel)
    if ".." in p.parts or len(p.parts) > 3:
        return False
    if p.parts[0] in PROTECTED_TOP_LEVEL or p.name in PROTECTED_NAMES:
        return False
    if p.name == "VERSION":
        return True
    return p.suffix.lower() in ALLOWED_SUFFIXES


# ---- Versions ---------------------------------------------------------------------------------
def parse_version(text: str):
    try:
        parts = tuple(int(x) for x in str(text).strip().split("."))
    except (ValueError, AttributeError):
        return None
    return parts if 1 <= len(parts) <= 4 else None


def current_version(install_dir: Path | None = None) -> str:
    try:
        return ((install_dir or HERE) / "VERSION").read_text(encoding="utf-8").strip() or "0.0.0"
    except OSError:
        return "0.0.0"


# ---- Settings / URLs --------------------------------------------------------------------------
def _read_settings() -> dict:
    try:
        data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def manifest_url() -> str:
    return os.environ.get("SQUEEZE_UPDATE_URL") or _read_settings().get("update_manifest_url") or DEFAULT_MANIFEST_URL


def _ssl_context():
    ctx = ssl.create_default_context()
    try:  # python.org builds on macOS ship without a CA bundle; certifi (if present) fixes that
        import certifi  # type: ignore
        ctx = ssl.create_default_context(cafile=certifi.where())
    except Exception:
        pass
    return ctx


def _open(url: str, timeout: float):
    req = urllib.request.Request(url, headers={"User-Agent": f"Squeeze/{current_version()}", "Cache-Control": "no-cache"})
    return urllib.request.urlopen(req, timeout=timeout, context=_ssl_context())


def _explain(exc: Exception) -> str:
    if isinstance(exc, ssl.SSLError) or "CERTIFICATE_VERIFY_FAILED" in str(exc):
        return "Couldn't verify the update server's security certificate."
    if isinstance(exc, urllib.error.HTTPError):
        return f"The update server answered with an error ({exc.code})."
    if isinstance(exc, (urllib.error.URLError, TimeoutError, OSError)):
        return "Couldn't reach the update server. Check your internet connection."
    return f"Update check failed: {exc}"


# ---- Manifest ---------------------------------------------------------------------------------
def fetch_manifest(timeout: float = 8.0) -> dict:
    url = manifest_url()
    fetch_url = url + ("&" if "?" in url else "?") + f"t={int(time.time())}"  # never a stale CDN copy
    try:
        with _open(fetch_url, timeout) as resp:
            raw = resp.read(MAX_MANIFEST_BYTES + 1)
    except Exception as exc:
        raise UpdateError(_explain(exc)) from exc
    if len(raw) > MAX_MANIFEST_BYTES:
        raise UpdateError("The update manifest is unexpectedly large -- ignoring it.")
    try:
        m = json.loads(raw.decode("utf-8"))
    except ValueError as exc:
        raise UpdateError("The update manifest isn't valid.") from exc

    ok = (
        isinstance(m, dict)
        and parse_version(m.get("version")) is not None
        and isinstance(m.get("zipFilename"), str)
        and "/" not in m["zipFilename"]
        and "\\" not in m["zipFilename"]
        and m["zipFilename"].endswith(".zip")
        and isinstance(m.get("sha256"), str)
        and len(m["sha256"]) == 64
        and isinstance(m.get("size"), int)
        and 0 < m["size"] <= MAX_ZIP_BYTES
        and isinstance(m.get("files"), dict)
    )
    if not ok:
        raise UpdateError("The update manifest is missing required fields.")
    m["_zipUrl"] = url.rsplit("/", 1)[0] + "/" + m["zipFilename"]
    return m


# ---- Status (what the UI banner reads) --------------------------------------------------------
_lock = threading.Lock()
_state = {"latest": None, "available": False, "notes": [], "releaseDate": None, "error": None, "checkedAt": 0.0, "checking": False}


def check() -> dict:
    """Ask the Vault for the newest release and record whether it's newer. Never raises."""
    with _lock:
        if _state["checking"]:
            return dict(_state)
        _state["checking"] = True
    try:
        m = fetch_manifest()
        newer = parse_version(m["version"]) > (parse_version(current_version()) or (0,))
        with _lock:
            _state.update(latest=m["version"], available=newer, notes=list(m.get("notes") or []),
                          releaseDate=m.get("releaseDate"), error=None)
    except UpdateError as exc:
        with _lock:
            _state.update(error=str(exc))
    except Exception as exc:  # pragma: no cover - defensive; a failed check must never break Squeeze
        with _lock:
            _state.update(error=f"Update check failed: {exc}")
    finally:
        with _lock:
            _state.update(checking=False, checkedAt=time.time())
    return dict(_state)


def check_async() -> None:
    threading.Thread(target=check, daemon=True).start()


def read_last_result() -> dict | None:
    try:
        data = json.loads(RESULT_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def clear_last_result() -> None:
    try:
        RESULT_FILE.unlink()
    except OSError:
        pass


def status() -> dict:
    with _lock:
        stale = time.time() - _state["checkedAt"] > RECHECK_SECONDS and not _state["checking"]
        snap = dict(_state)
    if stale:
        check_async()
    return {"current": current_version(), **snap, "lastResult": read_last_result()}


# ---- Download + verify + stage ----------------------------------------------------------------
def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def stage_latest() -> dict:
    """Download the newest release and unpack it into _update/staged/ -- touching NOTHING in the
    live install. Returns the manifest. Raises UpdateError with a user-readable reason."""
    m = fetch_manifest()
    if (parse_version(m["version"]) or (0,)) <= (parse_version(current_version()) or (0,)):
        raise UpdateError("Squeeze is already up to date.")

    shutil.rmtree(UPDATE_DIR / "staged", ignore_errors=True)
    shutil.rmtree(DOWNLOAD_DIR, ignore_errors=True)
    DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    STAGED_DIR.mkdir(parents=True, exist_ok=True)
    zpath = DOWNLOAD_DIR / m["zipFilename"]

    # -- download with a hard size cap
    try:
        total = 0
        h = hashlib.sha256()
        with _open(m["_zipUrl"], 60) as resp, open(zpath, "wb") as out:
            while True:
                chunk = resp.read(256 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_ZIP_BYTES:
                    raise UpdateError("The update download is larger than expected -- stopped.")
                h.update(chunk)
                out.write(chunk)
    except UpdateError:
        raise
    except Exception as exc:
        raise UpdateError(_explain(exc)) from exc
    if total != m["size"] or h.hexdigest() != m["sha256"]:
        raise UpdateError("The downloaded update didn't match its checksum -- nothing was changed. Try again.")

    # -- unpack only allowlisted files, each verified against the manifest
    staged: dict[str, str] = {}
    try:
        with zipfile.ZipFile(zpath) as z:
            infos = [i for i in z.infolist() if not i.is_dir()]
            firsts = {PurePosixPath(i.filename).parts[0] for i in infos if PurePosixPath(i.filename).parts}
            strip_root = len(firsts) == 1 and all(len(PurePosixPath(i.filename).parts) > 1 for i in infos)
            grand_total = 0
            for info in infos:
                parts = PurePosixPath(info.filename).parts
                rel = "/".join(parts[1:] if strip_root else parts)
                if not is_updatable(rel):
                    continue  # scripts, work folders, settings, etc. are never touched by an update
                if info.file_size > MAX_FILE_BYTES:
                    raise UpdateError(f"{rel} is unexpectedly large -- update stopped.")
                grand_total += info.file_size
                if grand_total > MAX_ZIP_BYTES * 2:
                    raise UpdateError("The update expands to an unexpected size -- stopped.")
                data = z.read(info)
                want = m["files"].get(rel)
                if not want or _sha256_bytes(data) != want:
                    raise UpdateError(f"{rel} didn't match its checksum -- nothing was changed.")
                dest = STAGED_DIR / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                staged[rel] = want
    except zipfile.BadZipFile as exc:
        raise UpdateError("The downloaded update isn't a valid ZIP file.") from exc

    missing = [f for f in REQUIRED_FILES if f not in staged]
    if missing:
        raise UpdateError(f"The update is incomplete (missing {', '.join(missing)}) -- nothing was changed.")
    if (STAGED_DIR / "VERSION").read_text(encoding="utf-8").strip() != m["version"]:
        raise UpdateError("The update's version doesn't match its manifest -- nothing was changed.")

    # -- syntax-check every Python file so a broken release can never replace a working one
    for rel in staged:
        if rel.endswith((".py", ".pyw")):
            try:
                compile((STAGED_DIR / rel).read_text(encoding="utf-8"), rel, "exec")
            except SyntaxError as exc:
                raise UpdateError(f"{rel} has a syntax error ({exc.msg}, line {exc.lineno}) -- nothing was changed.") from exc

    (STAGED_DIR / ".ready.json").write_text(
        json.dumps({"from": current_version(), "to": m["version"], "files": sorted(staged), "hashes": staged}), encoding="utf-8")
    return m


# ---- Hand-off to the helper that performs the swap --------------------------------------------
def _detached_kwargs() -> dict:
    if os.name == "nt":
        return {"creationflags": 0x00000008 | 0x00000200}  # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
    return {"start_new_session": True}


def spawn_apply_helper(wait_pid: int) -> None:
    """Start the swap helper as an independent process. The helper is a COPY of this module (so
    replacing squeeze_update.py during the swap can't affect the copy that's doing the work)."""
    helper = UPDATE_DIR / "apply_helper.py"
    shutil.copyfile(Path(__file__).resolve(), helper)
    exe = sys.executable
    subprocess.Popen(
        [exe, str(helper), "--apply", "--install", str(HERE), "--wait-pid", str(wait_pid)],
        cwd=str(HERE), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        close_fds=True, **_detached_kwargs(),
    )


# ---- Helper side: runs in the separate process ------------------------------------------------
def _wait_for_exit(pid: int, timeout: float) -> bool:
    """True once `pid` is gone. NOTE: os.kill(pid, 0) must not be used on Windows -- there it
    terminates the process instead of probing it."""
    if pid <= 0:
        return True
    if os.name == "nt":
        import ctypes
        k32 = ctypes.windll.kernel32  # type: ignore[attr-defined]
        handle = k32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return True  # can't open it -> it's already gone
        try:
            return k32.WaitForSingleObject(handle, int(timeout * 1000)) == 0
        finally:
            k32.CloseHandle(handle)
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            return True
        except PermissionError:
            pass
        time.sleep(0.25)
    return False


def _relaunch(install: Path) -> None:
    exe = Path(sys.executable)
    if os.name == "nt" and exe.name.lower() == "python.exe" and exe.with_name("pythonw.exe").exists():
        exe = exe.with_name("pythonw.exe")  # no console window flashing up
    subprocess.Popen(
        [str(exe), str(install / "launcher.pyw"), "--no-browser"],  # the browser tab is still open; it reloads itself
        cwd=str(install), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        close_fds=True, **_detached_kwargs(),
    )


def _write_result(install: Path, **kw) -> None:
    kw["at"] = time.time()
    (install / "_update").mkdir(exist_ok=True)
    (install / "_update" / "last_result.json").write_text(json.dumps(kw), encoding="utf-8")


def apply_staged(install: Path, wait_pid: int) -> bool:
    """Swap the staged files into `install`, roll back on any failure, then relaunch Squeeze."""
    stage = install / "_update" / "staged"
    backup = install / "_update" / "backup"
    try:
        info = json.loads((stage / ".ready.json").read_text(encoding="utf-8"))
        files = [f for f in info["files"] if is_updatable(f)]
        hashes = info["hashes"]
    except Exception:
        _write_result(install, ok=False, error="The staged update was missing or unreadable -- nothing was changed.")
        _relaunch(install)
        return False

    if not _wait_for_exit(wait_pid, 45):
        _write_result(install, ok=False, error="Squeeze didn't close in time to be updated -- nothing was changed.")
        return False  # the old process is still alive; don't start a second one

    shutil.rmtree(backup, ignore_errors=True)
    created: list[str] = []
    try:
        for rel in files:  # 1) back up everything we're about to replace
            dst = install / rel
            if dst.exists():
                (backup / rel).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(dst, backup / rel)
            else:
                created.append(rel)
        for rel in files:  # 2) replace each file atomically (temp file in the same folder, then rename)
            dst = install / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            tmp = dst.with_name(dst.name + ".updtmp")
            shutil.copyfile(stage / rel, tmp)
            os.replace(tmp, dst)
        for rel in files:  # 3) verify what actually landed on disk
            if _sha256_file(install / rel) != hashes[rel]:
                raise RuntimeError(f"{rel} didn't verify after copying")
            if rel.endswith((".py", ".pyw")):
                compile((install / rel).read_text(encoding="utf-8"), rel, "exec")
        if os.environ.get("SQUEEZE_UPDATE_TEST_FAIL") == "after_copy":  # test hook: proves rollback works
            raise RuntimeError("forced failure (test)")
    except Exception as exc:
        for rel in files:  # roll back
            try:
                if (backup / rel).exists():
                    shutil.copy2(backup / rel, install / rel)
                elif rel in created and (install / rel).exists():
                    (install / rel).unlink()
                (install / (rel + ".updtmp")).unlink(missing_ok=True)
            except OSError:
                pass
        _write_result(install, ok=False, error=f"The update failed and was rolled back ({exc}). Your previous version is still installed.")
        shutil.rmtree(stage, ignore_errors=True)
        _relaunch(install)
        return False

    _write_result(install, ok=True, **{"from": info.get("from"), "to": info.get("to")})
    shutil.rmtree(stage, ignore_errors=True)
    shutil.rmtree(install / "_update" / "download", ignore_errors=True)
    _relaunch(install)
    return True


def _main(argv: list[str]) -> int:
    if "--apply" not in argv:
        print("squeeze_update.py is a helper module; it isn't meant to be run directly.")
        return 2
    def arg(name: str, default: str = "") -> str:
        return argv[argv.index(name) + 1] if name in argv and argv.index(name) + 1 < len(argv) else default
    install = Path(arg("--install", str(HERE))).resolve()
    return 0 if apply_staged(install, int(arg("--wait-pid", "0") or 0)) else 1


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
