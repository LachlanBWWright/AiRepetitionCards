import type { ComponentProps } from "react";
import { Button as ShadcnButton } from "./components/button";
export { buttonVariants } from "./components/button";

export type ButtonVariant =
  "primary" | "secondary" | "danger" | "default" | "destructive" | "outline" | "link";
export type ButtonSize = "small" | "medium" | "large" | "icon" | "lg" | "sm" | "default";
export type ButtonProps = Omit<ComponentProps<typeof ShadcnButton>, "variant" | "size"> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
};

export function Button({ variant = "primary", size = "medium", ...props }: ButtonProps) {
  const shadcnVariant = {
    primary: "default",
    secondary: "outline",
    danger: "destructive",
    default: "default",
    destructive: "destructive",
    outline: "outline",
    link: "link",
  } as const;
  const shadcnSize = {
    small: "sm",
    medium: "default",
    large: "lg",
    icon: "icon",
    lg: "lg",
    sm: "sm",
    default: "default",
  } as const;
  return <ShadcnButton variant={shadcnVariant[variant]} size={shadcnSize[size]} {...props} />;
}
