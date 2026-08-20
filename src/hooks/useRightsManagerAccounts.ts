import { api } from "../lib/api";
import { useAsync } from "./useAsync";

// No cross-page sync needed here (unlike useClients/useAffiliationTags) -- these accounts are
// managed from the extension's side panel, a separate page entirely, so there's no same-tab
// mutation path to broadcast.
export function useRightsManagerAccounts() {
  const { data, loading, error, refetch } = useAsync(() => api.rightsManagerAccounts.list(), []);
  return { rightsManagerAccounts: data?.rightsManagerAccounts ?? [], loading, error, refetch };
}
