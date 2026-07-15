import { useState } from "react";
import { useClients, useClientMutations } from "../hooks/useClients";
import { ClientFormModal } from "../components/ClientFormModal";
import { LoadingBlock, StateBlock } from "../components/StateBlock";

export function HomePage() {
  const { clients, loading, refetch } = useClients();
  const { create } = useClientMutations(refetch);
  const [adding, setAdding] = useState(false);

  if (loading) return <LoadingBlock />;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Viral DRM</h1>
          <div className="page-subtitle">Select a client from the sidebar to view their social accounts and videos.</div>
        </div>
      </div>

      {clients.length === 0 && (
        <StateBlock title="No clients yet.">
          <p style={{ marginBottom: 12 }}>Add your first client to start tracking their videos.</p>
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            + Add Client
          </button>
        </StateBlock>
      )}

      {adding && <ClientFormModal onSave={(name) => create(name)} onClose={() => setAdding(false)} />}
    </div>
  );
}
