import { useCallback } from "react";
import { api } from "../lib/api";
import { useAsync } from "./useAsync";
import type { CreateVideoInput, SocialAccount, UpdateVideoInput, VideoWithDeadline } from "../../shared/types";

export function useVideos(socialAccountId: string | undefined) {
  const { data, loading, error, refetch } = useAsync<{
    socialAccount: SocialAccount | null;
    videos: VideoWithDeadline[];
  }>(
    () =>
      socialAccountId
        ? api.videos.listForAccount(socialAccountId)
        : Promise.resolve({ socialAccount: null, videos: [] }),
    [socialAccountId]
  );
  return {
    socialAccount: data?.socialAccount ?? null,
    videos: data?.videos ?? [],
    loading,
    error,
    refetch,
  };
}

export function useVideoMutations(socialAccountId: string, onChanged?: () => void) {
  const create = useCallback(
    async (input: CreateVideoInput) => {
      const result = await api.videos.create(socialAccountId, input);
      onChanged?.();
      return result.video;
    },
    [socialAccountId, onChanged]
  );
  const update = useCallback(
    async (id: string, input: UpdateVideoInput) => {
      const result = await api.videos.update(id, input);
      onChanged?.();
      return result.video;
    },
    [onChanged]
  );
  const remove = useCallback(
    async (id: string) => {
      await api.videos.remove(id);
      onChanged?.();
    },
    [onChanged]
  );
  return { create, update, remove };
}
