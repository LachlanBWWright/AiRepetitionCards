import type { ComponentProps, ReactNode } from "react";
import { Text, View } from "react-native";

export function Host({ children }: { readonly children?: ReactNode }) {
  return <View>{children}</View>;
}

function Picker({
  selectedValue,
  onValueChange,
  children,
  enabled = true,
}: {
  readonly selectedValue: string;
  readonly onValueChange: (value: string) => void;
  readonly children?: ReactNode;
  readonly enabled?: boolean;
}) {
  return (
    <select
      value={selectedValue}
      disabled={!enabled}
      onChange={(event) => {
        onValueChange(event.currentTarget.value);
      }}
    >
      {children}
    </select>
  );
}

Picker.Item = function PickerItem({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return <option value={value}>{label}</option>;
};

export { Picker };

export default function DateTimePicker({
  value,
  onValueChange,
}: {
  readonly value: Date;
  readonly onValueChange: (_event: unknown, selected: Date) => void;
}) {
  const onChange: NonNullable<ComponentProps<"input">["onChange"]> = (event) => {
    const [hours, minutes] = event.target.value.split(":").map(Number);
    if (hours === undefined || minutes === undefined) return;
    const next = new Date(value);
    next.setHours(hours, minutes, 0, 0);
    onValueChange(null, next);
  };
  return (
    <input
      aria-label="Study reminder time"
      type="time"
      value={`${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`}
      onChange={onChange}
    />
  );
}

export class EventEmitter {
  readonly kind = "EventEmitter";
}
export class SharedObject {
  readonly kind = "SharedObject";
}
export class SharedRef {
  readonly kind = "SharedRef";
}
export class NativeModule {
  readonly kind = "NativeModule";
}
export class CodedError extends Error {}
export const Platform = { OS: "web" } as const;
export const requireOptionalNativeModule = () => {
  return null;
};
export const requireNativeModule = () => {
  return {} as never;
};
export const requireNativeViewManager = () => {
  return "div";
};
export const registerWebModule = (module: unknown) => {
  return module;
};
export const registerNativeModule = (module: unknown) => {
  return module;
};
export const reloadAppAsync = () => Promise.resolve(undefined);
export const registerRootComponent = () => {
  return undefined;
};
export const TextNode = Text;
