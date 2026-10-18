import { useState } from "react";
import { Text, View } from "react-native";
import { NativeButton } from "@recall/ui-native";
import { findCardDuplicates } from "@recall/application";
import type { NativeNotebookModel } from "../useNativeKnowledgeNotebookModel";
export function NativeNotebookBatchReview({ model }: { readonly model: NativeNotebookModel }) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const entries = model.notebook?.proposals.filter((entry) => entry.status === "pending") ?? [];
  if (entries.length < 2) return null;
  const ids = entries.filter((entry) => selected.includes(entry.id)).map((entry) => entry.id);
  function toggle(id: string) {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }
  return (
    <View className="gap-4 rounded-lg border border-recall-line p-4">
      <Text className="text-lg font-bold text-recall-ink">Review proposed cards</Text>
      <Text className="text-recall-muted">
        Select reviewed proposals to approve together. Saving stops if a card cannot be saved.
        Review duplicate warnings individually.
      </Text>
      {entries.map((entry) => (
        <View key={entry.id} className="gap-2 border-b border-recall-line pb-3">
          <Text className="font-bold text-recall-ink">{entry.proposal.front}</Text>
          <Text className="text-recall-ink">{entry.proposal.back}</Text>
          <Text className="text-recall-muted">{entry.proposal.rationale}</Text>
          <NativeButton
            label={selected.includes(entry.id) ? "Selected" : "Select proposal"}
            tone="soft"
            disabled={
              model.busy ||
              !!model.unsaved ||
              findCardDuplicates(entry.proposal, model.duplicateCandidates).length > 0
            }
            onPress={() => {
              toggle(entry.id);
            }}
          />
        </View>
      ))}
      <NativeButton
        label={`Approve selected (${String(ids.length)})`}
        disabled={model.busy || !!model.unsaved || ids.length === 0}
        onPress={() => void model.approveSelected(ids)}
      />
    </View>
  );
}
