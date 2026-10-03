import type { ReactNode } from "react";

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
    <div className={`empty-state ${className}`.trim()}>
      {icon && <span aria-hidden="true">{icon}</span>}
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
