import { api } from "../lib/api";
import { useAsync } from "./useAsync";

export function useRightsManagerHistory(clientId: string | undefined) {
  const { data, loading, error, refetch } = useAsync(
    () => (clientId ? api.clients.rightsManagerHistory(clientId) : Promise.resolve({ batches: [] })),
    [clientId]
  );
  return { batches: data?.batches ?? [], loading, error, refetch };
}
