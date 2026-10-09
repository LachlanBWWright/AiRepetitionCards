"use client";
import * as React from "react";
import { Toaster as SonnerToaster, toast } from "sonner";
import { cn } from "cn";

type ToasterProps = React.ComponentProps<typeof SonnerToaster>;
function Toaster({ className, ...props }: ToasterProps) {
  return (
    <SonnerToaster
      data-slot="toaster"
      className={cn("toaster group", className)}
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-popover group-[.toaster]:text-popover-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
export { Toaster, toast };
