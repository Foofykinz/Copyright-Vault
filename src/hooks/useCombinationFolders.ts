import { useCallback, useEffect } from "react";
import { api } from "../lib/api";
import { useAsync } from "./useAsync";
import { emitDataEvent, onDataEvent } from "../lib/dataEvents";
import type { CombinationFolderWithComputed, VideoWithDeadline } from "../../shared/types";

export function useCombinationFolders(clientId: string | undefined) {
  const { data, loading, error, refetch } = useAsync(
    () => (clientId ? api.combinationFolders.listForClient(clientId) : Promise.resolve({ combinationFolders: [] })),
    [clientId]
  );
  useEffect(() => onDataEvent("combinationFolders", refetch), [refetch]);
  return { combinationFolders: data?.combinationFolders ?? [], loading, error, refetch };
}

export function useAllCombinationFolders() {
  const { data, loading, error, refetch } = useAsync(() => api.combinationFolders.listAll(), []);
  useEffect(() => onDataEvent("combinationFolders", refetch), [refetch]);
  return { combinationFolders: data?.combinationFolders ?? [], loading, error, refetch };
}

export function useCombinationFolder(id: string | undefined) {
  const { data, loading, error, refetch } = useAsync<{
    combinationFolder: CombinationFolderWithComputed | null;
    videos: VideoWithDeadline[];
  }>(() => (id ? api.combinationFolders.get(id) : Promise.resolve({ combinationFolder: null, videos: [] })), [id]);
  useEffect(() => onDataEvent("combinationFolders", refetch), [refetch]);
  return {
    combinationFolder: data?.combinationFolder ?? null,
    videos: data?.videos ?? [],
    loading,
    error,
    refetch,
  };
}

export function useCombinationFolderMutations(onChanged?: () => void) {
  const create = useCallback(
    async (clientId: string, name: string, videoIds?: string[]) => {
      const result = await api.combinationFolders.create({ clientId, name, videoIds });
      onChanged?.();
      emitDataEvent("combinationFolders");
      return result.combinationFolder;
    },
    [onChanged]
  );
  const rename = useCallback(
    async (id: string, name: string) => {
      const result = await api.combinationFolders.update(id, { name });
      onChanged?.();
      emitDataEvent("combinationFolders");
      return result.combinationFolder;
    },
    [onChanged]
  );
  const remove = useCallback(
    async (id: string) => {
      await api.combinationFolders.remove(id);
      onChanged?.();
      emitDataEvent("combinationFolders");
    },
    [onChanged]
  );
  const addVideos = useCallback(
    async (id: string, videoIds: string[]) => {
      const result = await api.combinationFolders.addVideos(id, videoIds);
      onChanged?.();
      emitDataEvent("combinationFolders");
      return result.combinationFolder;
    },
    [onChanged]
  );
  const removeVideo = useCallback(
    async (id: string, videoId: string) => {
      const result = await api.combinationFolders.removeVideo(id, videoId);
      onChanged?.();
      emitDataEvent("combinationFolders");
      return result.combinationFolder;
    },
    [onChanged]
  );
  return { create, rename, remove, addVideos, removeVideo };
}
