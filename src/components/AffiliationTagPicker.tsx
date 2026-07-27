import { useEffect, useMemo, useRef, useState } from "react";
import { useAffiliationTags, useAffiliationTagMutations } from "../hooks/useAffiliationTags";

interface AffiliationTagPickerProps {
  value: string | null;
  onChange: (tagId: string | null) => void;
}

export function AffiliationTagPicker({ value, onChange }: AffiliationTagPickerProps) {
  const { affiliationTags, loading } = useAffiliationTags();
  const { getOrCreate } = useAffiliationTagMutations();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(() => affiliationTags.find((t) => t.id === value) ?? null, [affiliationTags, value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? affiliationTags.filter((t) => t.name.toLowerCase().includes(q)) : affiliationTags;
  }, [affiliationTags, query]);

  const exactMatch = useMemo(
    () => affiliationTags.some((t) => t.name.toLowerCase() === query.trim().toLowerCase()),
    [affiliationTags, query]
  );

  useEffect(() => {
    if (!open) return;
    setQuery("");
    inputRef.current?.focus();

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    // Captured (and stopped) so this doesn't also trigger the parent Modal's own Escape-to-close.
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  const handleCreate = async () => {
    const name = query.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const tag = await getOrCreate(name);
      onChange(tag.id);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="combo" ref={containerRef}>
      <button type="button" className="combo-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="combo-trigger-label">{selected ? selected.name : "No affiliation"}</span>
        <span className="combo-trigger-caret">▾</span>
      </button>

      {open && (
        <div className="combo-panel">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search or create a tag…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim() && !exactMatch) {
                e.preventDefault();
                void handleCreate();
              }
            }}
          />
          <ul className="sidebar-list combo-list">
            <li>
              <button
                type="button"
                className="sidebar-link combo-option"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                No affiliation
              </button>
            </li>
            {loading && <li className="sidebar-empty">Loading…</li>}
            {filtered.map((tag) => (
              <li key={tag.id}>
                <button
                  type="button"
                  className="sidebar-link combo-option"
                  onClick={() => {
                    onChange(tag.id);
                    setOpen(false);
                  }}
                >
                  {tag.name}
                </button>
              </li>
            ))}
            {query.trim() && !exactMatch && (
              <li>
                <button
                  type="button"
                  className="sidebar-link combo-option create"
                  onClick={() => void handleCreate()}
                  disabled={busy}
                >
                  {busy ? "Creating…" : `+ Create "${query.trim()}"`}
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
