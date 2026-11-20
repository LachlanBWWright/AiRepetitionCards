import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import { NativeSelect } from "./NativeSelect";

export function NativeWorkflowSections({
  label,
  sections,
  revealSection,
  revealKey,
}: {
  readonly revealSection?: string | undefined;
  readonly revealKey?: unknown;
  readonly label: string;
  readonly sections: readonly {
    readonly id: string;
    readonly label: string;
    readonly content: ReactNode;
  }[];
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    if (revealSection) setActive(revealSection);
  }, [revealSection, revealKey]);
  return (
    <View className="gap-4">
      <NativeSelect
        label={label}
        value={active}
        options={sections.map(({ id, label: title }) => ({ value: id, label: title }))}
        onValueChange={(value) => {
          if (sections.some((section) => section.id === value)) setActive(value);
        }}
      />
      {sections.map((section) => (
        <View
          key={section.id}
          style={{ display: active === section.id ? "flex" : "none" }}
          accessibilityElementsHidden={active !== section.id}
          importantForAccessibility={active === section.id ? "auto" : "no-hide-descendants"}
          className="gap-4"
        >
          {section.content}
        </View>
      ))}
    </View>
  );
}
