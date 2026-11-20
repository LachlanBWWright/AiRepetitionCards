import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { NativeCollapsibleTrigger } from "@recall/ui-native";

/** Keep draft controls mounted while optional tools are tucked away. */
export function NativeCardEditorSection({
  title,
  initiallyOpen = false,
  children,
}: {
  readonly title: string;
  readonly initiallyOpen?: boolean;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View className="border-t border-recall-line pt-2">
      <NativeCollapsibleTrigger
        title={title}
        open={open}
        onToggle={() => {
          setOpen(!open);
        }}
      />
      <View
        style={{ display: open ? "flex" : "none" }}
        className="gap-3"
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        {children}
      </View>
    </View>
  );
}
