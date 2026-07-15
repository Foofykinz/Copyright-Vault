import { useState, type FormEvent } from "react";
import { Modal } from "./Modal";
import { api } from "../lib/api";
import type { CreateVideoInput, SocialAccount } from "../../shared/types";
import { PLATFORM_LABELS } from "../../shared/types";

interface ManualVideoEntryModalProps {
  socialAccount: SocialAccount;
  onSave: (input: CreateVideoInput) => Promise<unknown>;
  onClose: () => void;
}

type MetadataState = "idle" | "loading" | "done" | "error";

function splitIsoDateTime(iso: string): [string, string | null] {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(iso);
  if (!match) return [iso.slice(0, 10), null];
  return [match[1], match[2] ?? null];
}

export function ManualVideoEntryModal({ socialAccount, onSave, onClose }: ManualVideoEntryModalProps) {
  const [videoUrl, setVideoUrl] = useState("");
  const [publicationDate, setPublicationDate] = useState("");
  const [publicationTime, setPublicationTime] = useState("");
  const [caption, setCaption] = useState("");
  const [viewCount, setViewCount] = useState("0");
  const [notes, setNotes] = useState("");
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [metadataState, setMetadataState] = useState<MetadataState>("idle");
  const [metadataNote, setMetadataNote] = useState<string | null>(null);

  const fetchMetadata = async () => {
    const trimmed = videoUrl.trim();
    if (!trimmed) return;
    try {
      new URL(trimmed);
    } catch {
      return;
    }

    setMetadataState("loading");
    setMetadataNote(null);
    try {
      const { metadata } = await api.metadata.lookup(trimmed);
      if (metadata.caption) setCaption(metadata.caption);
      if (metadata.publicationDate) {
        const [datePart, timePart] = splitIsoDateTime(metadata.publicationDate);
        setPublicationDate(datePart);
        if (timePart) setPublicationTime(timePart);
      }
      if (metadata.viewCount !== undefined) setViewCount(String(metadata.viewCount));
      if (metadata.thumbnailUrl) setThumbnailUrl(metadata.thumbnailUrl);
      setMetadataNote(metadata.warning ?? null);
      setMetadataState("done");
    } catch (err) {
      setMetadataNote(err instanceof Error ? err.message : "Couldn't fetch details automatically. Enter them manually.");
      setMetadataState("error");
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!videoUrl.trim()) return setError("Video URL is required.");
    if (!publicationDate) return setError("Publication date is required.");
    if (!caption.trim()) return setError("Caption/title is required.");
    const viewCountNum = Number(viewCount);
    if (!Number.isFinite(viewCountNum) || !Number.isInteger(viewCountNum) || viewCountNum < 0) {
      return setError("View count must be a non-negative whole number.");
    }

    setBusy(true);
    setError(null);
    try {
      const publicationDateIso = publicationTime ? `${publicationDate}T${publicationTime}:00` : publicationDate;
      await onSave({
        videoUrl: videoUrl.trim(),
        publicationDate: publicationDateIso,
        caption: caption.trim(),
        viewCount: viewCountNum,
        notes: notes.trim() || null,
        thumbnailUrl,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save video.");
      setBusy(false);
    }
  };

  return (
    <Modal title="Add Video" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label>Social account</label>
          <div className="text-secondary">
            {socialAccount.accountName} · {PLATFORM_LABELS[socialAccount.platform]}
          </div>
        </div>
        <div className="field">
          <label htmlFor="video-url">Video URL</label>
          <div className="flex-row">
            <input
              id="video-url"
              type="url"
              placeholder="https://…"
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              onBlur={fetchMetadata}
              autoFocus
            />
            <button type="button" className="btn btn-sm" onClick={fetchMetadata} disabled={metadataState === "loading"}>
              {metadataState === "loading" ? "Fetching…" : "Fetch details"}
            </button>
          </div>
          {metadataState === "loading" && <span className="hint">Fetching video details…</span>}
          {metadataNote && metadataState !== "loading" && <span className="hint">{metadataNote}</span>}
        </div>
        <div className="field-row">
          <div className="field">
            <label htmlFor="video-date">Publication date</label>
            <input id="video-date" type="date" value={publicationDate} onChange={(e) => setPublicationDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="video-time">Publication time (optional)</label>
            <input id="video-time" type="time" value={publicationTime} onChange={(e) => setPublicationTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="video-caption">Caption / title</label>
          <textarea id="video-caption" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="video-views">View count</label>
          <input id="video-views" type="number" min={0} step={1} value={viewCount} onChange={(e) => setViewCount(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="video-notes">Notes (optional)</label>
          <textarea id="video-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <span className="field-error">{error}</span>}
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "Saving…" : "Add Video"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
