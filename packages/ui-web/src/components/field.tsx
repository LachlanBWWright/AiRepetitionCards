import * as React from "react";
import { cn } from "cn";

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex min-w-0 flex-col gap-6", className)}
      {...props}
    />
  );
}
function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="field" className={cn("flex min-w-0 flex-col gap-2", className)} {...props} />
  );
}
function FieldLabel({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="field-label"
      className={cn("text-sm leading-none font-medium", className)}
      {...props}
    />
  );
}
function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}
function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn("text-sm text-[var(--recall-danger-foreground)]", className)}
      {...props}
    />
  );
}
export { Field, FieldDescription, FieldError, FieldGroup, FieldLabel };
