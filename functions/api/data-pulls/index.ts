import type { ApiHandler } from "../../lib/env";
import { errorResponse, json } from "../../lib/http";
import { DATA_PULL_SELECT, mapDataPull, parseDataPullFilters, type DataPullRow } from "../../lib/dataPulls";
import type { DataPullListResult } from "../../../shared/types";

/** Paginated, filterable list for the Data Pulls page, most recently pulled first. */
export const onRequestGet: ApiHandler = async (context) => {
  try {
    const db = context.env.DB;
    const url = new URL(context.request.url);
    const { where, values } = parseDataPullFilters(url);
    const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50));

    const countRow = await db.prepare(`SELECT COUNT(*) as count FROM data_pulls dp ${where}`).bind(...values).first<{ count: number }>();
    const total = countRow?.count ?? 0;
    const rows = await db
      .prepare(`${DATA_PULL_SELECT} ${where} ORDER BY dp.last_pulled_at DESC LIMIT ? OFFSET ?`)
      .bind(...values, pageSize, (page - 1) * pageSize)
      .all<DataPullRow>();

    const result: DataPullListResult = {
      dataPulls: rows.results.map(mapDataPull),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
    return json(result);
  } catch (err) {
    return errorResponse(err);
  }
};
