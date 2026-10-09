import type { ReactNode } from "react";
import { Badge } from "./components/badge";

export type StatusTone = "neutral" | "success" | "warning" | "danger";

export function StatusBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: StatusTone;
}) {
  const toneClasses: Record<StatusTone, string> = {
    neutral: "bg-muted text-muted-foreground",
    success: "bg-[var(--status-success-bg)] text-[var(--status-success-fg)]",
    warning: "bg-[var(--status-warning-bg)] text-[var(--status-warning-fg)]",
    danger: "bg-[var(--status-danger-bg)] text-[var(--status-danger-fg)]",
  };
  return <Badge variant="outline" className={toneClasses[tone]}>{children}</Badge>;
}
