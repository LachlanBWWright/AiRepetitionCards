import { Text, View } from "react-native";
import { NativeButton } from "@recall/ui-native";
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
  const rows = studySubjectTree(workspace);
  if (!rows.some((row) => row.hasChildren)) return null;
  return (
    <View className="gap-2 rounded border border-recall-line p-3">
      <Text accessibilityRole="header">Subject hierarchy</Text>
      {rows.map(({ area, depth, hasChildren }) => (
        <View
          key={area.id}
          style={{ marginLeft: Math.min(depth, 12) * 12 }}
          className="flex-row flex-wrap gap-2"
        >
          <NativeButton
            label={area.title}
            tone="soft"
            disabled={disabled}
            onPress={() => {
              onOpen(area.id);
            }}
          />
          {hasChildren && (
            <NativeButton
              label={`Study ${area.title} and descendants`}
              disabled={disabled}
              onPress={() => {
                onStudy(`scope:${area.id}`);
              }}
            />
          )}
        </View>
      ))}
    </View>
  );
}
