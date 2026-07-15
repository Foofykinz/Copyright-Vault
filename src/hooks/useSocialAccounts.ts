import { useCallback } from "react";
import { api } from "../lib/api";
import { useAsync } from "./useAsync";
import type { CreateSocialAccountInput, SocialAccount, UpdateSocialAccountInput } from "../../shared/types";

export function useSocialAccounts(clientId: string | undefined) {
  const { data, loading, error, refetch } = useAsync(
    () => (clientId ? api.socialAccounts.listForClient(clientId) : Promise.resolve({ socialAccounts: [] })),
    [clientId]
  );
  return { socialAccounts: data?.socialAccounts ?? [], loading, error, refetch };
}

export function useSocialAccount(id: string | undefined) {
  const { data, loading, error, refetch } = useAsync<{ socialAccount: SocialAccount | null }>(
    () => (id ? api.socialAccounts.get(id) : Promise.resolve({ socialAccount: null })),
    [id]
  );
  return { socialAccount: data?.socialAccount ?? null, loading, error, refetch };
}

export function useSocialAccountMutations(clientId: string, onChanged?: () => void) {
  const create = useCallback(
    async (input: Omit<CreateSocialAccountInput, "clientId">) => {
      const result = await api.socialAccounts.create(clientId, { ...input, clientId });
      onChanged?.();
      return result.socialAccount;
    },
    [clientId, onChanged]
  );
  const update = useCallback(
    async (id: string, input: UpdateSocialAccountInput) => {
      const result = await api.socialAccounts.update(id, input);
      onChanged?.();
      return result.socialAccount;
    },
    [onChanged]
  );
  const remove = useCallback(
    async (id: string) => {
      await api.socialAccounts.remove(id);
      onChanged?.();
    },
    [onChanged]
  );
  return { create, update, remove };
}
