import { useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { useClient, useClientMutations, useClientStats } from "../hooks/useClients";
import { useSocialAccountMutations, useSocialAccounts } from "../hooks/useSocialAccounts";
import { Breadcrumb } from "../components/Breadcrumb";
import { ClientFormModal } from "../components/ClientFormModal";
import { SocialAccountFormModal } from "../components/SocialAccountFormModal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PlatformTag } from "../components/PlatformTag";
import { StateBlock, LoadingBlock, ErrorBlock } from "../components/StateBlock";
import { formatDisplayDate } from "../../shared/format";
import type { SocialAccount } from "../../shared/types";

export function ClientPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const navigate = useNavigate();

  const { client, loading, error, refetch } = useClient(clientId);
  const { stats } = useClientStats(clientId);
  const { socialAccounts, loading: accountsLoading, refetch: refetchAccounts } = useSocialAccounts(clientId);

  const { rename, archive, remove } = useClientMutations(refetch);
  const accountMutations = useSocialAccountMutations(clientId ?? "", refetchAccounts);

  const [editingClient, setEditingClient] = useState(false);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [editingAccount, setEditingAccount] = useState<SocialAccount | null>(null);
  const [removingAccount, setRemovingAccount] = useState<SocialAccount | null>(null);

  if (loading) return <LoadingBlock />;
  if (error) return <ErrorBlock message={error} />;
  if (!client) return <StateBlock title="Client not found." />;

  return (
    <div>
      <Breadcrumb items={[{ label: "Clients", to: "/" }, { label: client.name }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">
            {client.name}
            {client.archived && <span className="badge badge-neutral" style={{ marginLeft: 8 }}>Archived</span>}
          </h1>
          <div className="page-subtitle">
            {socialAccounts.length} social account{socialAccounts.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setEditingClient(true)}>
            Edit Client
          </button>
          <button className="btn" onClick={() => setConfirmingArchive(true)}>
            {client.archived ? "Unarchive" : "Archive"}
          </button>
          <button className="btn btn-danger" onClick={() => setConfirmingDelete(true)}>
            Delete
          </button>
          <button className="btn btn-primary" onClick={() => setAddingAccount(true)}>
            + Add Social Account
          </button>
        </div>
      </div>

      {stats && (
        <div className="stats-strip">
          <div className="stat-tile">
            <div className="stat-tile-label">Total videos</div>
            <div className="stat-tile-value">{stats.totalVideos}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Unassigned videos</div>
            <div className="stat-tile-value">{stats.unassignedVideos}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Due in 30 days</div>
            <div className="stat-tile-value">{stats.dueSoonVideos}</div>
          </div>
          <div className="stat-tile">
            <div className="stat-tile-label">Most recent pull</div>
            <div className="stat-tile-value" style={{ fontSize: 13 }}>
              {stats.mostRecentPullAt ? formatDisplayDate(stats.mostRecentPullAt) : "Never pulled"}
            </div>
          </div>
        </div>
      )}

      {accountsLoading ? (
        <LoadingBlock />
      ) : socialAccounts.length === 0 ? (
        <StateBlock title="No social accounts yet.">
          <p>Add a social account manually to start tracking videos for this client.</p>
        </StateBlock>
      ) : (
        <div className="card-list">
          {socialAccounts.map((account) => (
            <div className="account-card" key={account.id}>
              <Link to={`/clients/${client.id}/social/${account.id}`} style={{ flex: 1, minWidth: 0, textDecoration: "none", color: "inherit" }}>
                <div className="account-card-main">
                  <div className="account-card-name">
                    <PlatformTag platform={account.platform} />
                    {account.accountName}
                  </div>
                  <div className="account-card-meta">
                    {account.profileUrl || "No profile URL set"} · Last pulled:{" "}
                    {account.lastPullAt ? formatDisplayDate(account.lastPullAt) : "Never"}
                  </div>
                </div>
              </Link>
              <div className="account-card-actions">
                {account.profileUrl ? (
                  <a
                    href={account.profileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-sm"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Open profile
                  </a>
                ) : (
                  <button className="btn btn-sm" disabled title="Add a profile URL to enable this">
                    Open profile
                  </button>
                )}
                <button className="btn btn-sm" onClick={() => setEditingAccount(account)}>
                  Edit
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => setRemovingAccount(account)}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editingClient && (
        <ClientFormModal client={client} onSave={(name) => rename(client.id, name)} onClose={() => setEditingClient(false)} />
      )}

      {confirmingArchive && (
        <ConfirmDialog
          title={client.archived ? "Unarchive client" : "Archive client"}
          message={
            client.archived
              ? `${client.name} will reappear in the active client list.`
              : `${client.name} will be hidden from the active client list. Their data is kept and can be restored later.`
          }
          confirmLabel={client.archived ? "Unarchive" : "Archive"}
          onCancel={() => setConfirmingArchive(false)}
          onConfirm={async () => {
            await archive(client.id, !client.archived);
            setConfirmingArchive(false);
          }}
        />
      )}

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete client"
          message={`This permanently deletes ${client.name}, all of their social accounts, videos, and Combination Folders. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await remove(client.id);
            navigate("/");
          }}
        />
      )}

      {addingAccount && (
        <SocialAccountFormModal onSave={(values) => accountMutations.create(values)} onClose={() => setAddingAccount(false)} />
      )}

      {editingAccount && (
        <SocialAccountFormModal
          account={editingAccount}
          onSave={(values) => accountMutations.update(editingAccount.id, values)}
          onClose={() => setEditingAccount(null)}
        />
      )}

      {removingAccount && (
        <ConfirmDialog
          title="Remove social account"
          message={`This permanently deletes ${removingAccount.accountName} and all of its collected videos. This cannot be undone.`}
          confirmLabel="Remove"
          danger
          onCancel={() => setRemovingAccount(null)}
          onConfirm={async () => {
            await accountMutations.remove(removingAccount.id);
            setRemovingAccount(null);
          }}
        />
      )}
    </div>
  );
}
