import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatDisplayDate, formatViewCount } from "../../shared/format";
import { PlatformTag } from "./PlatformTag";
import { DeadlineBadge } from "./DeadlineBadge";
import { ConfirmDialog } from "./ConfirmDialog";
import type { VideoWithDeadline } from "../../shared/types";

interface VideoTableRowProps {
  video: VideoWithDeadline;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onUpdated: () => void;
  onDeleted: () => void;
  removeFromFolderId?: string;
}

type EditField = "caption" | "viewCount" | "notes" | "publicationDate" | null;

export function VideoTableRow({ video, selected, onToggleSelect, onUpdated, onDeleted, removeFromFolderId }: VideoTableRowProps) {
  const [editing, setEditing] = useState<EditField>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const startEdit = (field: EditField, initial: string) => {
    setEditing(field);
    setDraft(initial);
  };

  const commitEdit = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      if (editing === "caption") await api.videos.update(video.id, { caption: draft });
      if (editing === "notes") await api.videos.update(video.id, { notes: draft });
      if (editing === "publicationDate") await api.videos.update(video.id, { publicationDate: draft });
      if (editing === "viewCount") {
        const num = Number(draft);
        if (Number.isFinite(num) && Number.isInteger(num) && num >= 0) {
          await api.videos.update(video.id, { viewCount: num });
        }
      }
      onUpdated();
    } finally {
      setSaving(false);
      setEditing(null);
    }
  };

  const rowStyle: CSSProperties = video.folders.length > 0 ? { ["--row-folder-color" as string]: video.folders[0].color } : {};

  return (
    <tr className={video.folders.length > 0 ? "folder-row-indicator" : ""} style={rowStyle}>
      <td>
        <input
          type="checkbox"
          className="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(video.id)}
          aria-label={`Select video: ${video.caption ?? video.videoUrl}`}
        />
      </td>
      <td>
        {editing === "publicationDate" ? (
          <input
            type="date"
            autoFocus
            value={draft.slice(0, 10)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => e.key === "Enter" && commitEdit()}
            disabled={saving}
          />
        ) : (
          <span onClick={() => startEdit("publicationDate", video.publicationDate)} style={{ cursor: "text" }}>
            {formatDisplayDate(video.publicationDate)}
          </span>
        )}
      </td>
      <td className="wrap">
        {editing === "caption" ? (
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => e.key === "Enter" && commitEdit()}
            disabled={saving}
          />
        ) : (
          <span
            className="truncate"
            onClick={() => startEdit("caption", video.caption ?? "")}
            title={video.caption ?? undefined}
            style={{ cursor: "text" }}
          >
            {video.caption || <span className="text-secondary">—</span>}
          </span>
        )}
      </td>
      <td>
        <PlatformTag platform={video.platform} />
      </td>
      <td>
        {editing === "viewCount" ? (
          <input
            type="number"
            min={0}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => e.key === "Enter" && commitEdit()}
            disabled={saving}
            style={{ width: 90 }}
          />
        ) : (
          <span onClick={() => startEdit("viewCount", String(video.viewCount))} style={{ cursor: "text" }} className="mono">
            {formatViewCount(video.viewCount)}
          </span>
        )}
      </td>
      <td>
        <DeadlineBadge daysRemaining={video.daysRemaining} status={video.deadlineStatus} />
      </td>
      <td>
        <span className="folder-dots">
          {video.folders.map((f) => (
            <Link key={f.id} to={`/folders/${f.id}`} title={f.name}>
              <span className="color-dot" style={{ background: f.color }} />
            </Link>
          ))}
          {video.folders.length === 0 && <span className="text-secondary">—</span>}
        </span>
      </td>
      <td className="wrap">
        {editing === "notes" ? (
          <input
            type="text"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={(e) => e.key === "Enter" && commitEdit()}
            disabled={saving}
          />
        ) : (
          <span
            className="truncate"
            onClick={() => startEdit("notes", video.notes ?? "")}
            title={video.notes ?? undefined}
            style={{ cursor: "text" }}
          >
            {video.notes || <span className="text-secondary">—</span>}
          </span>
        )}
      </td>
      <td>
        <a href={video.videoUrl} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
          Open
        </a>
      </td>
      <td>
        <div className="flex-row">
          {removeFromFolderId && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={async () => {
                await api.combinationFolders.removeVideo(removeFromFolderId, video.id);
                onUpdated();
              }}
            >
              Remove
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
        </div>
      </td>

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete video"
          message="This permanently deletes the video record and removes it from any Combination Folders. This cannot be undone."
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await api.videos.remove(video.id);
            setConfirmingDelete(false);
            onDeleted();
          }}
        />
      )}
    </tr>
  );
}
