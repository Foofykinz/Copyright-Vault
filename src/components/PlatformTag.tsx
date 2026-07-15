import { PLATFORM_LABELS, type Platform } from "../../shared/types";

export function PlatformTag({ platform }: { platform: Platform }) {
  return <span className="platform-tag">{PLATFORM_LABELS[platform]}</span>;
}
