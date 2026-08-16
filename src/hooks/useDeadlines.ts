import { api } from "../lib/api";
import { useAsync } from "./useAsync";

export function useDeadlines(status?: string) {
  const { data, loading, error, refetch } = useAsync(() => api.videos.deadlines(status), [status]);
  return { videos: data?.videos ?? [], loading, error, refetch };
}
