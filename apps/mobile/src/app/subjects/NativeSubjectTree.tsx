import { useState } from "react";
import { View } from "react-native";
import { NativeButton, NativeNavigationLink, NativeCollapsible } from "@recall/ui-native";
import { studySubjectTree } from "@recall/application";
import type { Workspace } from "@recall/domain";
export function NativeSubjectTree({
  workspace,
  disabled,
  onOpen,
  onStudy,
}: {
  readonly workspace: Workspace;
  readonly disabled: boolean;
  readonly onOpen: (id: string) => void;
  readonly onStudy: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = studySubjectTree(workspace);
  if (!rows.some((row) => row.hasChildren)) return null;
  return (
    <NativeCollapsible
      title="Subject groups"
      open={open}
      onToggle={() => {
        setOpen(!open);
      }}
    >
      {rows.map(({ area, depth, hasChildren }) => (
        <View key={area.id} style={{ marginLeft: Math.min(depth, 12) * 12 }} className="gap-2">
          <NativeNavigationLink
            label={area.title}
            disabled={disabled}
            onPress={() => {
              onOpen(area.id);
            }}
          />
          {hasChildren && (
            <NativeButton
              label={`Study ${area.title} and descendants`}
              variant="secondary"
              disabled={disabled}
              onPress={() => {
                onStudy(`scope:${area.id}`);
              }}
            />
          )}
        </View>
      ))}
    </NativeCollapsible>
  );
}
