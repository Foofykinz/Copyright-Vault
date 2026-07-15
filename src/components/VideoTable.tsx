import { useMemo, useState } from "react";
import { VideoTableRow } from "./VideoTableRow";
import { CombinationFolderAssignModal } from "./CombinationFolderAssignModal";
import { StateBlock } from "./StateBlock";
import { PLATFORM_LABELS, PLATFORMS, type DeadlineStatus, type Platform, type VideoWithDeadline } from "../../shared/types";

interface VideoTableProps {
  videos: VideoWithDeadline[];
  clientId: string;
  onChanged: () => void;
  removeFromFolderId?: string;
  emptyMessage?: string;
}

type SortKey = "publicationDate" | "caption" | "platform" | "viewCount" | "daysRemaining";
type SortDir = "asc" | "desc";

const DEADLINE_FILTER_LABELS: Record<DeadlineStatus, string> = {
  neutral: "On track (30+ days)",
  amber: "Due soon (8–30 days)",
  urgent: "Urgent (0–7 days)",
  expired: "Expired",
};

export function VideoTable({ videos, clientId, onChanged, removeFromFolderId, emptyMessage }: VideoTableProps) {
  const [search, setSearch] = useState("");
  const [platformFilter, setPlatformFilter] = useState<Platform | "all">("all");
  const [folderFilter, setFolderFilter] = useState<string>("all");
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineStatus | "all">("all");
  const [sortKey, setSortKey] = useState<SortKey>("publicationDate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [assigning, setAssigning] = useState(false);

  const availableFolders = useMemo(() => {
    const map = new Map<string, { id: string; name: string; color: string }>();
    for (const v of videos) for (const f of v.folders) map.set(f.id, f);
    return [...map.values()];
  }, [videos]);

  const availablePlatforms = useMemo(() => {
    const set = new Set(videos.map((v) => v.platform));
    return PLATFORMS.filter((p) => set.has(p));
  }, [videos]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return videos.filter((v) => {
      if (term) {
        const haystack = `${v.caption ?? ""} ${v.videoUrl} ${v.notes ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (platformFilter !== "all" && v.platform !== platformFilter) return false;
      if (folderFilter === "unassigned" && v.folders.length > 0) return false;
      if (folderFilter !== "all" && folderFilter !== "unassigned" && !v.folders.some((f) => f.id === folderFilter)) return false;
      if (deadlineFilter !== "all" && v.deadlineStatus !== deadlineFilter) return false;
      return true;
    });
  }, [videos, search, platformFilter, folderFilter, deadlineFilter]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    copy.sort((a, b) => {
      let cmp = 0;
      if (sortKey === "publicationDate") cmp = a.publicationDate.localeCompare(b.publicationDate);
      else if (sortKey === "caption") cmp = (a.caption ?? "").localeCompare(b.caption ?? "");
      else if (sortKey === "platform") cmp = a.platform.localeCompare(b.platform);
      else if (sortKey === "viewCount") cmp = a.viewCount - b.viewCount;
      else if (sortKey === "daysRemaining") cmp = a.daysRemaining - b.daysRemaining;
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "caption" || key === "platform" ? "asc" : "desc");
    }
  };

  const toggleSelect = (id: string) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelection((prev) => (prev.size === sorted.length ? new Set() : new Set(sorted.map((v) => v.id))));
  };

  const headerSort = (key: SortKey, label: string) => (
    <th className={sortKey === key ? "sorted" : ""} onClick={() => toggleSort(key)}>
      {label}
      {sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div>
      <div className="toolbar">
        <input
          type="search"
          className="toolbar-search"
          placeholder="Search caption, URL, notes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value as Platform | "all")} style={{ width: 140 }}>
          <option value="all">All platforms</option>
          {availablePlatforms.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>
        <select value={folderFilter} onChange={(e) => setFolderFilter(e.target.value)} style={{ width: 170 }}>
          <option value="all">All folders</option>
          <option value="unassigned">Unassigned</option>
          {availableFolders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
        <select value={deadlineFilter} onChange={(e) => setDeadlineFilter(e.target.value as DeadlineStatus | "all")} style={{ width: 190 }}>
          <option value="all">All deadlines</option>
          {(Object.keys(DEADLINE_FILTER_LABELS) as DeadlineStatus[]).map((status) => (
            <option key={status} value={status}>
              {DEADLINE_FILTER_LABELS[status]}
            </option>
          ))}
        </select>
        <div className="toolbar-spacer" />
        {selection.size > 0 && (
          <>
            <span className="text-secondary">{selection.size} selected</span>
            <button className="btn btn-primary btn-sm" onClick={() => setAssigning(true)}>
              Add to Combination Folder
            </button>
          </>
        )}
      </div>

      {sorted.length === 0 ? (
        <StateBlock title={emptyMessage ?? "No videos match the current filters."} />
      ) : (
        <div className="table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={selection.size === sorted.length}
                    onChange={toggleSelectAll}
                    aria-label="Select all videos"
                  />
                </th>
                {headerSort("publicationDate", "Published")}
                {headerSort("caption", "Caption / Title")}
                {headerSort("platform", "Platform")}
                {headerSort("viewCount", "Views")}
                {headerSort("daysRemaining", "Days Left")}
                <th>Folders</th>
                <th>Notes</th>
                <th>Link</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((video) => (
                <VideoTableRow
                  key={video.id}
                  video={video}
                  selected={selection.has(video.id)}
                  onToggleSelect={toggleSelect}
                  onUpdated={onChanged}
                  onDeleted={() => {
                    setSelection((prev) => {
                      const next = new Set(prev);
                      next.delete(video.id);
                      return next;
                    });
                    onChanged();
                  }}
                  removeFromFolderId={removeFromFolderId}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assigning && (
        <CombinationFolderAssignModal
          clientId={clientId}
          videoIds={[...selection]}
          onDone={() => {
            setSelection(new Set());
            onChanged();
          }}
          onClose={() => setAssigning(false)}
        />
      )}
    </div>
  );
}
