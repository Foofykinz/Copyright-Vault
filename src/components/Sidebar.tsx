import { useState } from "react";
import { NavLink } from "react-router-dom";
import { useClients, useClientMutations } from "../hooks/useClients";
import { useAllCombinationFolders } from "../hooks/useCombinationFolders";
import { ClientFormModal } from "./ClientFormModal";

export function Sidebar() {
  const { clients, loading: clientsLoading, refetch: refetchClients } = useClients();
  const { combinationFolders, loading: foldersLoading } = useAllCombinationFolders();
  const { create } = useClientMutations(refetchClients);
  const [addingClient, setAddingClient] = useState(false);

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

      {addingClient && (
        <ClientFormModal
          onSave={(name) => create(name)}
          onClose={() => setAddingClient(false)}
        />
      )}
    </aside>
  );
}
