import { api } from "../lib/api";
import { useAsync } from "./useAsync";
import type { InfringementReportListParams } from "../../shared/types";

/** Backs the Rights Manager archive tab ("Copyright Archive") — always paginated, always scoped to
 * source: "rights_manager", unlike the plain Infringements tab's unpaginated, all-sources list. */
export function useRightsManagerArchive(filters: InfringementReportListParams, page: number, pageSize: number) {
  const params: InfringementReportListParams = { ...filters, source: "rights_manager", page, pageSize };
  const { data, loading, error, refetch } = useAsync(
    () => api.infringementReports.list(params),
    // Deps must be primitives for useAsync's shallow-per-item comparison -- JSON.stringify the
    // filter object rather than passing it directly (a new object every render would refetch
    // on every render regardless of whether anything actually changed).
    [JSON.stringify(filters), page, pageSize]
  );
  return {
    infringementReports: data?.infringementReports ?? [],
    total: data?.total ?? 0,
    totalPages: data?.totalPages ?? 1,
    loading,
    error,
    refetch,
  };
}
