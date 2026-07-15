/**
 * Minimal pub-sub so the persistent sidebar (clients, combination folders) stays in sync when
 * those entities are mutated from other pages, without pulling in a data-fetching library.
 */
type Topic = "clients" | "combinationFolders";
type Listener = () => void;

const listeners: Record<Topic, Set<Listener>> = {
  clients: new Set(),
  combinationFolders: new Set(),
};

export function onDataEvent(topic: Topic, listener: Listener): () => void {
  listeners[topic].add(listener);
  return () => listeners[topic].delete(listener);
}

export function emitDataEvent(topic: Topic): void {
  listeners[topic].forEach((listener) => listener());
}
