"use client";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/** Source-owned shadcn/Radix composition, adapted to Recall's existing action styles. */
export const buttonVariants = cva(
  "ui-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-semibold transition-colors disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "ui-button-primary",
        default: "ui-button-primary",
        secondary: "ui-button-secondary",
        outline: "ui-button-secondary",
        quiet: "ui-button-quiet",
        ghost: "ui-button-quiet",
        danger: "ui-button-danger",
        destructive: "ui-button-danger",
        link: "ui-button-link underline-offset-4 hover:underline",
      },
      size: {
        small: "ui-button-small",
        sm: "ui-button-small",
        medium: "ui-button-medium",
        default: "ui-button-medium",
        lg: "ui-button-large",
        icon: "ui-button-icon",
      },
    },
    defaultVariants: { variant: "primary", size: "medium" },
  },
);

export type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
export type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;
export type ButtonProps = ComponentProps<"button"> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Supply one element, such as an anchor, whose semantic behavior is retained. */
  readonly asChild?: boolean;
};

export function Button({
  variant = "primary",
  size = "medium",
  className,
  type,
  asChild = false,
  disabled,
  onClickCapture,
  tabIndex,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      {...props}
      data-slot="button"
      type={asChild ? type : (type ?? "button")}
      disabled={disabled}
      aria-disabled={disabled || props["aria-disabled"]}
      tabIndex={asChild && disabled ? -1 : tabIndex}
      onClickCapture={(event) => {
        if (asChild && disabled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onClickCapture?.(event);
      }}
      className={cn(buttonVariants({ variant, size }), className)}
    />
  );
}
