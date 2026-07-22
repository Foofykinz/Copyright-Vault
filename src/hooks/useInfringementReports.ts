import { useCallback } from "react";
import { api } from "../lib/api";
import { useAsync } from "./useAsync";
import type { CreateInfringementReportInput, InfringementStatus, UpdateInfringementReportInput } from "../../shared/types";

export function useInfringementReports(statusFilter: InfringementStatus | "all") {
  const { data, loading, error, refetch } = useAsync(
    () => api.infringementReports.list(statusFilter === "all" ? undefined : { status: statusFilter }),
    [statusFilter]
  );
  return { infringementReports: data?.infringementReports ?? [], loading, error, refetch };
}

export function useInfringementReportMutations(onChanged?: () => void) {
  const create = useCallback(
    async (input: CreateInfringementReportInput) => {
      const result = await api.infringementReports.create(input);
      onChanged?.();
      return result.infringementReport;
    },
    [onChanged]
  );
  const update = useCallback(
    async (id: string, input: UpdateInfringementReportInput) => {
      const result = await api.infringementReports.update(id, input);
      onChanged?.();
      return result.infringementReport;
    },
    [onChanged]
  );
  const remove = useCallback(
    async (id: string) => {
      await api.infringementReports.remove(id);
      onChanged?.();
    },
    [onChanged]
  );
  return { create, update, remove };
}
