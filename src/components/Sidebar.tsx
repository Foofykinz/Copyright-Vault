import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useClients, useClientMutations } from "../hooks/useClients";
import { useAllCombinationFolders } from "../hooks/useCombinationFolders";
import { ClientFormModal } from "./ClientFormModal";
import { ChangePasswordModal } from "./ChangePasswordModal";
import type { Client, SessionUser } from "../../shared/types";

function ClientPicker({ clients, loading }: { clients: Client[]; loading: boolean }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeClient = useMemo(() => {
    const match = /^\/clients\/([^/]+)/.exec(location.pathname);
    return match ? (clients.find((c) => c.id === match[1]) ?? null) : null;
  }, [location.pathname, clients]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? clients.filter((c) => c.name.toLowerCase().includes(q)) : clients;
  }, [clients, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    inputRef.current?.focus();

    const handlePointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="client-picker" ref={containerRef}>
      <button type="button" className="client-picker-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="client-picker-trigger-label">{activeClient ? activeClient.name : "All clients"}</span>
        <span className="client-picker-trigger-caret">▾</span>
      </button>

      {open && (
        <div className="client-picker-panel">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search clients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="sidebar-list client-picker-list">
            {loading && <li className="sidebar-empty">Loading…</li>}
            {!loading && filtered.length === 0 && <li className="sidebar-empty">No matches.</li>}
            {filtered.map((client) => (
              <li key={client.id}>
                <NavLink
                  to={`/clients/${client.id}`}
                  className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  {client.name}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Sidebar({ user, onLogout }: { user: SessionUser; onLogout: () => Promise<void> }) {
  const { clients, loading: clientsLoading, refetch: refetchClients } = useClients();
  const { combinationFolders, loading: foldersLoading } = useAllCombinationFolders();
  const { create } = useClientMutations(refetchClients);
  const [addingClient, setAddingClient] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    <aside className="sidebar">
      <div className="sidebar-header">Viral DRM</div>

      <div className="sidebar-section">
        <div className="sidebar-section-title">
          <span>Clients</span>
        </div>
        <ClientPicker clients={clients} loading={clientsLoading} />
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 6, width: "100%" }} onClick={() => setAddingClient(true)}>
          + Add Client
        </button>
      </div>

      <div className="sidebar-section" style={{ flex: 1, overflowY: "auto" }}>
        <div className="sidebar-section-title">
          <span>Combination Folders</span>
        </div>
        <ul className="sidebar-list">
          {foldersLoading && <li className="sidebar-empty">Loading…</li>}
          {!foldersLoading && combinationFolders.length === 0 && <li className="sidebar-empty">No folders yet.</li>}
          {combinationFolders.map((folder) => (
            <li key={folder.id}>
              <NavLink to={`/folders/${folder.id}`} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
                <span className="color-dot" style={{ background: folder.color }} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{folder.name}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      <div className="sidebar-section">
        <ul className="sidebar-list">
          <li>
            <NavLink to="/dashboard" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              Dashboard
            </NavLink>
          </li>
          <li>
            <NavLink to="/infringements" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              Infringements
            </NavLink>
          </li>
          <li>
            <NavLink to="/extension" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              Extension
            </NavLink>
          </li>
        </ul>
      </div>

      <div className="sidebar-user">
        <span className="sidebar-user-name" title={user.username}>
          {user.name}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={() => setChangingPassword(true)}>
          Change password
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => void onLogout()}>
          Log out
        </button>
      </div>

      {addingClient && (
        <ClientFormModal
          onSave={(name) => create(name)}
          onClose={() => setAddingClient(false)}
        />
      )}
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </aside>
  );
}
