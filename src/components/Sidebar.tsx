import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useClients, useClientMutations } from "../hooks/useClients";
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
    <div className="combo" ref={containerRef}>
      <button type="button" className="combo-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="combo-trigger-label">{activeClient ? activeClient.name : "All clients"}</span>
        <span className="combo-trigger-caret">▾</span>
      </button>

      {open && (
        <div className="combo-panel">
          <input
            ref={inputRef}
            type="text"
            placeholder="Search clients…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <ul className="sidebar-list combo-list">
            {loading && <li className="sidebar-empty">Loading…</li>}
            {!loading && filtered.length === 0 && <li className="sidebar-empty">No matches.</li>}
            {filtered.map((client) => (
              <li key={client.id}>
                <NavLink
                  to={`/clients/${client.id}`}
                  className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}
                  onClick={() => setOpen(false)}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{client.name}</span>
                  {client.affiliationTagName && <span className="tag-pill">{client.affiliationTagName}</span>}
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

      <div className="sidebar-section" style={{ flex: 1 }}>
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
            <NavLink to="/rights-manager" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              Rights Manager
            </NavLink>
          </li>
          <li>
            <NavLink to="/data-pulls" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              Data Pulls
            </NavLink>
          </li>
          <li>
            <NavLink to="/extension" className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
              Extensions &amp; Tools
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
          onSave={(input) => create(input)}
          onClose={() => setAddingClient(false)}
        />
      )}
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </aside>
  );
}
