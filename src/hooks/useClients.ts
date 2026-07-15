import { useCallback, useEffect } from "react";
import { api } from "../lib/api";
import { useAsync } from "./useAsync";
import { emitDataEvent, onDataEvent } from "../lib/dataEvents";
import type { Client, ClientStats } from "../../shared/types";

export function useClients() {
  const { data, loading, error, refetch } = useAsync(() => api.clients.list(), []);
  useEffect(() => onDataEvent("clients", refetch), [refetch]);
  return { clients: data?.clients ?? [], loading, error, refetch };
}

export function useClient(clientId: string | undefined) {
  const { data, loading, error, refetch } = useAsync<{ client: Client | null }>(
    () => (clientId ? api.clients.get(clientId) : Promise.resolve({ client: null })),
    [clientId]
  );
  return { client: data?.client ?? null, loading, error, refetch };
}

export function useClientStats(clientId: string | undefined) {
  const { data, loading, error, refetch } = useAsync<{ stats: ClientStats | null }>(
    () => (clientId ? api.clients.stats(clientId) : Promise.resolve({ stats: null })),
    [clientId]
  );
  return { stats: data?.stats ?? null, loading, error, refetch };
}

export function useClientMutations(onChanged?: () => void) {
  const create = useCallback(
    async (name: string) => {
      const result = await api.clients.create({ name });
      onChanged?.();
      emitDataEvent("clients");
      return result.client;
    },
    [onChanged]
  );
  const rename = useCallback(
    async (id: string, name: string) => {
      const result = await api.clients.update(id, { name });
      onChanged?.();
      emitDataEvent("clients");
      return result.client;
    },
    [onChanged]
  );
  const archive = useCallback(
    async (id: string, archived: boolean) => {
      const result = await api.clients.update(id, { archived });
      onChanged?.();
      emitDataEvent("clients");
      return result.client;
    },
    [onChanged]
  );
  const remove = useCallback(
    async (id: string) => {
      await api.clients.remove(id);
      onChanged?.();
      emitDataEvent("clients");
    },
    [onChanged]
  );
  return { create, rename, archive, remove };
}
