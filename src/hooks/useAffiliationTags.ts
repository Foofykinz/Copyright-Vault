import { useCallback, useEffect } from "react";
import { api } from "../lib/api";
import { useAsync } from "./useAsync";
import { emitDataEvent, onDataEvent } from "../lib/dataEvents";

export function useAffiliationTags() {
  const { data, loading, error, refetch } = useAsync(() => api.affiliationTags.list(), []);
  useEffect(() => onDataEvent("affiliationTags", refetch), [refetch]);
  return { affiliationTags: data?.affiliationTags ?? [], loading, error, refetch };
}

export function useAffiliationTagMutations() {
  const getOrCreate = useCallback(async (name: string) => {
    const result = await api.affiliationTags.getOrCreate({ name });
    emitDataEvent("affiliationTags");
    return result.affiliationTag;
  }, []);
  return { getOrCreate };
}
