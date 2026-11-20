"use client";

import type { ReactNode } from "react";
import { cn } from "cn";

export function NavigationLink({
  href,
  onNavigate,
  disabled = false,
  className,
  children,
}: {
  readonly href: string;
  readonly onNavigate: () => void;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <a
      href={disabled ? undefined : href}
      role={disabled ? "link" : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      className={cn(
        "self-start rounded-sm text-sm text-primary underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring aria-disabled:pointer-events-none aria-disabled:opacity-50",
        className,
      )}
      onClick={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        onNavigate();
      }}
    >
      {children}
    </a>
  );
}
