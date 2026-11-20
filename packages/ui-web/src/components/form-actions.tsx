import type { ComponentProps } from "react";
import { cn } from "cn";

/** Secondary actions precede the primary action; phones show the primary action first. */
export function FormActions({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="form-actions"
      className={cn(
        "flex w-full min-w-0 flex-col-reverse items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end [&>button]:w-full sm:[&>button]:w-auto [&>a[data-slot=button]]:w-full sm:[&>a[data-slot=button]]:w-auto",
        className,
      )}
      {...props}
    />
  );
}
