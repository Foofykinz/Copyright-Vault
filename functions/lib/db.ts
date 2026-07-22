import type { Client, CombinationFolder, InfringementReport, InfringementStatus, Platform, SocialAccount, Video } from "../../shared/types";
import { NotFoundError } from "./http";

interface ClientRow {
  id: string;
  name: string;
  archived: number;
  created_at: string;
  updated_at: string;
}

interface SocialAccountRow {
  id: string;
  client_id: string;
  platform: string;
  account_name: string;
  profile_url: string | null;
  last_pull_at: string | null;
  created_at: string;
  updated_at: string;
  youtube_channel_id?: string | null;
  youtube_uploads_playlist_id?: string | null;
  youtube_handle?: string | null;
}

interface VideoRow {
  id: string;
  client_id: string;
  social_account_id: string;
  platform: string;
  video_url: string;
  publication_date: string;
  caption: string | null;
  view_count: number;
  view_count_checked_at: string | null;
  thumbnail_url: string | null;
  notes: string | null;
  collected_at: string;
  created_at: string;
  updated_at: string;
  youtube_category?: string | null;
  rights_manager_sent_at?: string | null;
}

interface CombinationFolderRow {
  id: string;
  client_id: string;
  name: string;
  color: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface InfringementReportRow {
  id: string;
  client_id: string | null;
  infringer_name: string;
  infringing_url: string;
  platform: string;
  posted_at: string;
  notes: string | null;
  status: string;
  found_by_user_id: string;
  created_at: string;
  updated_at: string;
}

export function mapClient(row: ClientRow): Client {
  return {
    id: row.id,
    name: row.name,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapSocialAccount(row: SocialAccountRow): SocialAccount {
  return {
    id: row.id,
    clientId: row.client_id,
    platform: row.platform as Platform,
    accountName: row.account_name,
    profileUrl: row.profile_url,
    lastPullAt: row.last_pull_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    youtubeChannelId: row.youtube_channel_id ?? null,
    youtubeUploadsPlaylistId: row.youtube_uploads_playlist_id ?? null,
    youtubeHandle: row.youtube_handle ?? null,
  };
}

export function mapVideo(row: VideoRow): Video {
  return {
    id: row.id,
    clientId: row.client_id,
    socialAccountId: row.social_account_id,
    platform: row.platform as Platform,
    videoUrl: row.video_url,
    publicationDate: row.publication_date,
    caption: row.caption,
    viewCount: row.view_count,
    viewCountCheckedAt: row.view_count_checked_at,
    thumbnailUrl: row.thumbnail_url,
    notes: row.notes,
    collectedAt: row.collected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    youtubeCategory: (row.youtube_category as Video["youtubeCategory"]) ?? null,
    rightsManagerSentAt: row.rights_manager_sent_at ?? null,
  };
}

export function mapCombinationFolder(row: CombinationFolderRow): CombinationFolder {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    color: row.color,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapInfringementReport(row: InfringementReportRow): InfringementReport {
  return {
    id: row.id,
    clientId: row.client_id,
    infringerName: row.infringer_name,
    infringingUrl: row.infringing_url,
    platform: row.platform as Platform,
    postedAt: row.posted_at,
    notes: row.notes,
    status: row.status as InfringementStatus,
    foundByUserId: row.found_by_user_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getClientOrThrow(db: D1Database, id: string): Promise<Client> {
  const row = await db.prepare("SELECT * FROM clients WHERE id = ?").bind(id).first<ClientRow>();
  if (!row) throw new NotFoundError("Client not found.");
  return mapClient(row);
}

export async function getSocialAccountOrThrow(db: D1Database, id: string): Promise<SocialAccount> {
  const row = await db.prepare("SELECT * FROM social_accounts WHERE id = ?").bind(id).first<SocialAccountRow>();
  if (!row) throw new NotFoundError("Social account not found.");
  return mapSocialAccount(row);
}

export async function getVideoOrThrow(db: D1Database, id: string): Promise<Video> {
  const row = await db.prepare("SELECT * FROM videos WHERE id = ?").bind(id).first<VideoRow>();
  if (!row) throw new NotFoundError("Video not found.");
  return mapVideo(row);
}

export async function getCombinationFolderOrThrow(db: D1Database, id: string): Promise<CombinationFolder> {
  const row = await db
    .prepare("SELECT * FROM combination_folders WHERE id = ?")
    .bind(id)
    .first<CombinationFolderRow>();
  if (!row) throw new NotFoundError("Combination folder not found.");
  return mapCombinationFolder(row);
}

export async function getInfringementReportOrThrow(db: D1Database, id: string): Promise<InfringementReport> {
  const row = await db.prepare("SELECT * FROM infringement_reports WHERE id = ?").bind(id).first<InfringementReportRow>();
  if (!row) throw new NotFoundError("Infringement report not found.");
  return mapInfringementReport(row);
}
