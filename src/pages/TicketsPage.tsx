import { useState } from "react";
import type { ClipboardEvent, FormEvent } from "react";
import { api } from "../lib/api";
import { TICKETS_CHANGED_EVENT } from "../lib/ticketEvents";
import { useAsync } from "../hooks/useAsync";
import { useCurrentUser } from "../hooks/useCurrentUser";
import { Breadcrumb } from "../components/Breadcrumb";
import { Modal } from "../components/Modal";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { LoadingBlock, ErrorBlock, StateBlock } from "../components/StateBlock";
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  type Ticket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from "../../shared/types";


const PRIORITY_BADGE_CLASS: Record<TicketPriority, string> = {
  low: "badge-neutral",
  normal: "badge-neutral",
  high: "badge-amber",
  urgent: "badge-urgent",
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** Everyone sees this. A screenshot can be attached by file picker or by pasting an image
 * (Ctrl+V / Cmd+V) anywhere in the form. */
function SubmitTicketForm() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [category, setCategory] = useState<TicketCategory>("bug");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const attach = async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Screenshots must be an image file.");
      return;
    }
    setError(null);
    setScreenshot(await readAsDataUrl(file));
  };

  const handlePaste = (e: ClipboardEvent<HTMLFormElement>) => {
    const image = [...e.clipboardData.items].find((item) => item.type.startsWith("image/"));
    if (image) {
      e.preventDefault();
      void attach(image.getAsFile());
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!title.trim() || !description.trim()) {
      setError("Add a title and a description.");
      return;
    }
    setBusy(true);
    try {
      await api.tickets.create({ title: title.trim(), description: description.trim(), priority, category, screenshotDataUrl: screenshot });
      setTitle("");
      setDescription("");
      setPriority("normal");
      setCategory("bug");
      setScreenshot(null);
      setSent(true);
      window.dispatchEvent(new Event(TICKETS_CHANGED_EVENT));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the ticket.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel" onSubmit={handleSubmit} onPaste={handlePaste} style={{ maxWidth: 720 }}>
      <h2 style={{ marginTop: 0, fontSize: 15 }}>Submit a ticket</h2>
      <div className="field">
        <label htmlFor="ticket-title">Title</label>
        <input id="ticket-title" type="text" value={title} maxLength={200} onChange={(e) => { setTitle(e.target.value); setSent(false); }} disabled={busy} />
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="ticket-category">Category</label>
          <select id="ticket-category" value={category} onChange={(e) => setCategory(e.target.value as TicketCategory)} disabled={busy}>
            {TICKET_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TICKET_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ticket-priority">Priority</label>
          <select id="ticket-priority" value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)} disabled={busy}>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="ticket-description">Description</label>
        <textarea id="ticket-description" rows={6} value={description} maxLength={5000} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
      </div>
      <div className="field">
        <label htmlFor="ticket-screenshot">Screenshot (optional) — choose a file, or paste an image anywhere in this form</label>
        <input id="ticket-screenshot" type="file" accept="image/*" onChange={(e) => void attach(e.target.files?.[0])} disabled={busy} />
        {screenshot && (
          <div className="flex-row" style={{ alignItems: "flex-start", gap: 8, marginTop: 6 }}>
            <img src={screenshot} alt="Attached screenshot" style={{ maxWidth: 240, maxHeight: 160, borderRadius: 4, border: "1px solid var(--border)" }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setScreenshot(null)} disabled={busy}>
              Remove
            </button>
          </div>
        )}
      </div>
      {error && <div className="field-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="flex-row" style={{ gap: 10 }}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? "Sending…" : "Send ticket"}
        </button>
        {sent && <span className="text-secondary">Sent — thanks!</span>}
      </div>
    </form>
  );
}

function TicketModal({ ticket, onClose, onChanged }: { ticket: Ticket; onClose: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const changeStatus = async (next: TicketStatus) => {
    setError(null);
    setStatus(next);
    try {
      await api.tickets.update(ticket.id, { status: next });
      onChanged();
    } catch (err) {
      setStatus(ticket.status);
      setError(err instanceof Error ? err.message : "Couldn't update the ticket.");
    }
  };

  return (
    <Modal title={ticket.title} onClose={onClose} wide>
      <div className="flex-row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <span className={`badge ${PRIORITY_BADGE_CLASS[ticket.priority]}`}>{TICKET_PRIORITY_LABELS[ticket.priority]}</span>
        <span className="tag-pill">{TICKET_CATEGORY_LABELS[ticket.category]}</span>
        <span className="text-secondary">
          From {ticket.createdByName} · {new Date(ticket.createdAt).toLocaleString()}
        </span>
      </div>
      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", marginBottom: 16 }}>{ticket.description}</div>
      {ticket.hasAttachment && (
        <a href={api.tickets.attachmentUrl(ticket.id)} target="_blank" rel="noreferrer" title="Open full size">
          <img
            src={api.tickets.attachmentUrl(ticket.id)}
            alt="Ticket screenshot"
            style={{ maxWidth: "100%", borderRadius: 4, border: "1px solid var(--border)", marginBottom: 16 }}
          />
        </a>
      )}
      {error && <div className="field-error" style={{ marginBottom: 8 }}>{error}</div>}
      <div className="flex-row" style={{ gap: 10 }}>
        <label className="text-secondary" htmlFor="ticket-status">
          Status
        </label>
        <select id="ticket-status" value={status} onChange={(e) => void changeStatus(e.target.value as TicketStatus)} style={{ width: 160 }}>
          {TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {TICKET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <span className="toolbar-spacer" style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setConfirmingDelete(true)}>
          Delete
        </button>
      </div>
      {confirmingDelete && (
        <ConfirmDialog
          title="Delete ticket"
          message={`This permanently deletes "${ticket.title}" and its screenshot. This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={async () => {
            await api.tickets.remove(ticket.id);
            onChanged();
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

type InboxTab = TicketStatus | "all";
const INBOX_TABS: InboxTab[] = ["open", "in_progress", "closed", "all"];

/** Only rendered for the inbox owner; the API refuses everyone else regardless. */
function TicketInbox() {
  const [tab, setTab] = useState<InboxTab>("open");
  const [selected, setSelected] = useState<Ticket | null>(null);
  const { data, loading, error, refetch } = useAsync(() => api.tickets.list(tab === "all" ? undefined : tab), [tab]);
  const tickets = data?.tickets ?? [];

  const changed = () => {
    refetch();
    window.dispatchEvent(new Event(TICKETS_CHANGED_EVENT));
  };

  const open = (ticket: Ticket) => {
    setSelected(ticket);
    if (!ticket.seenAt) void api.tickets.update(ticket.id, { seen: true }).then(changed);
  };

  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 15 }}>
        Inbox{data && data.unseenCount > 0 ? ` · ${data.unseenCount} new` : ""}
      </h2>
      <div className="toolbar">
        {INBOX_TABS.map((t) => (
          <button key={t} className={`btn btn-sm ${tab === t ? "btn-primary" : ""}`} onClick={() => setTab(t)}>
            {t === "all" ? "All" : TICKET_STATUS_LABELS[t]}
          </button>
        ))}
      </div>
      {error && <ErrorBlock message={error} />}
      {loading ? (
        <LoadingBlock />
      ) : tickets.length === 0 ? (
        <StateBlock title="No tickets here." />
      ) : (
        <div className="table-wrap">
          <table className="dense-table">
            <thead>
              <tr>
                <th></th>
                <th>Priority</th>
                <th>Title</th>
                <th>Category</th>
                <th>From</th>
                <th>Submitted</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => (
                <tr key={t.id} onClick={() => open(t)} style={{ cursor: "pointer", fontWeight: t.seenAt ? undefined : 600 }}>
                  <td>{t.seenAt ? "" : <span className="badge badge-amber">New</span>}</td>
                  <td>
                    <span className={`badge ${PRIORITY_BADGE_CLASS[t.priority]}`}>{TICKET_PRIORITY_LABELS[t.priority]}</span>
                  </td>
                  <td className="wrap">
                    {t.title}
                    {t.hasAttachment ? " 📎" : ""}
                  </td>
                  <td>{TICKET_CATEGORY_LABELS[t.category]}</td>
                  <td>{t.createdByName}</td>
                  <td>{new Date(t.createdAt).toLocaleString()}</td>
                  <td>{TICKET_STATUS_LABELS[t.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {selected && <TicketModal ticket={selected} onClose={() => setSelected(null)} onChanged={changed} />}
    </div>
  );
}

export function TicketsPage() {
  const user = useCurrentUser();
  return (
    <div>
      <Breadcrumb items={[{ label: "Tickets" }]} />
      <div className="page-header">
        <div>
          <h1 className="page-title">Tickets</h1>
          <div className="page-subtitle">Report a problem or ask for something. Tickets are private — only the inbox owner can read them.</div>
        </div>
      </div>
      <SubmitTicketForm />
      {user.ticketInboxAccess && <TicketInbox />}
    </div>
  );
}
