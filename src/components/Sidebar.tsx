import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useClients, useClientMutations } from "../hooks/useClients";
import { useAllCombinationFolders } from "../hooks/useCombinationFolders";
import { ClientFormModal } from "./ClientFormModal";
import { ChangePasswordModal } from "./ChangePasswordModal";
import type { SessionUser } from "../../shared/types";

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
        <ul className="sidebar-list">
          {clientsLoading && <li className="sidebar-empty">Loading…</li>}
          {!clientsLoading && clients.length === 0 && <li className="sidebar-empty">No clients yet.</li>}
          {clients.map((client) => (
            <li key={client.id}>
              <NavLink to={`/clients/${client.id}`} className={({ isActive }) => `sidebar-link ${isActive ? "active" : ""}`}>
                {client.name}
              </NavLink>
            </li>
          ))}
        </ul>
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
