import type { ReactNode } from "react";
import { Text } from "react-native";
import type { NativeButtonVariant } from "./NativeButton";

/** Label and supporting text for composed shared buttons. */
export function NativeButtonText({
  children,
  variant = "default",
  detail = false,
}: {
  readonly children: ReactNode;
  readonly variant?: NativeButtonVariant;
  readonly detail?: boolean;
}) {
  const color = variant === "secondary" || variant === "ghost" ? "text-recall-ink" : "text-white";
  return (
    <Text className={`${color} ${detail ? "text-xs" : "text-sm font-semibold"}`}>{children}</Text>
  );
}
