import type { DeadlineStatus } from "../../shared/types";

interface DeadlineBadgeProps {
  daysRemaining: number;
  status: DeadlineStatus;
}

export function DeadlineBadge({ daysRemaining, status }: DeadlineBadgeProps) {
  const label = status === "expired" ? "Expired" : `${daysRemaining}d`;
  return <span className={`badge badge-${status}`}>{label}</span>;
}
