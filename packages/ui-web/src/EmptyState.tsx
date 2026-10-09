import type { ReactNode } from "react";
import { cn } from "./lib/utils";

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: string;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("text-center", className)}>
      {icon && <span className="mb-2 block text-2xl text-primary" aria-hidden="true">{icon}</span>}
      <h3 className="my-2 text-lg font-semibold">{title}</h3>
      <p className="mb-3 text-sm text-muted-foreground">{description}</p>
      {action}
    </div>
  );
}
