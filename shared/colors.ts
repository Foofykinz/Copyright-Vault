/**
 * Restrained, reusable palette for Combination Folders. These are grouping identifiers, not
 * status colors, so amber/red/green are intentionally excluded to avoid clashing with the
 * deadline-warning palette used elsewhere in the UI.
 */
export const FOLDER_COLOR_PALETTE = [
  "#3b82f6", // blue
  "#14b8a6", // teal
  "#8b5cf6", // purple
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#6366f1", // indigo
  "#a855f7", // violet
  "#0ea5e9", // sky
] as const;

/** Deterministically assigns the next folder color based on how many folders a client already has. */
export function nextFolderColor(existingFolderCount: number): string {
  return FOLDER_COLOR_PALETTE[existingFolderCount % FOLDER_COLOR_PALETTE.length];
}
