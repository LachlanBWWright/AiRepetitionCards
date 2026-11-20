import type { ComponentProps } from "react";
import { Button as ShadcnButton } from "./components/button";
export { buttonVariants } from "./components/button";

export type ButtonProps = ComponentProps<typeof ShadcnButton>;
export type ButtonVariant = NonNullable<ButtonProps["variant"]>;
export type ButtonSize = NonNullable<ButtonProps["size"]>;
export { ShadcnButton as Button };
