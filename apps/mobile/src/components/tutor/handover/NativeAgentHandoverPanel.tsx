import { useState } from "react";
import { ScrollView, Switch, Text, View } from "react-native";
import { NativeButton, NativeCollapsible, NativeSelect, NativeTextField } from "@recall/ui-native";
import { AGENT_TASKS, MAX_AGENT_JSON_BYTES } from "@recall/application";
import { useAgentHandover, type AgentHandoverProps, type AgentHandoverModel } from "@recall/react";

function Choice({
  label,
  checked,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (value: boolean) => void;
  readonly disabled: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="flex-1 text-recall-ink">{label}</Text>
      <Switch
        accessibilityLabel={label}
        value={checked}
        onValueChange={onChange}
        disabled={disabled}
      />
    </View>
  );
}
function Preview({ model }: { readonly model: AgentHandoverModel }) {
  const [expanded, setExpanded] = useState<readonly number[]>([]);
  if (!model.preview) return null;
  return (
    <View className="gap-4">
      {model.preview.changes.map((change, index) => (
        <NativeCollapsible
          key={index}
          title={change.title}
          open={expanded.includes(index)}
          onToggle={() => {
            setExpanded((values) =>
              values.includes(index)
                ? values.filter((value) => value !== index)
                : [...values, index],
            );
          }}
        >
          <Text className="font-bold text-recall-ink">Before</Text>
          <Text selectable className="text-recall-ink">
            {change.before ?? "New content"}
          </Text>
          <Text className="font-bold text-recall-ink">After</Text>
          <Text selectable className="text-recall-ink">
            {change.after ?? "Deleted (review history preserved)"}
          </Text>
        </NativeCollapsible>
      ))}
      {model.preview.changes.some((change) => change.destructive) && (
        <Choice
          label="I approve the listed deletions"
          checked={model.allowDeletion}
          onChange={model.setAllowDeletion}
          disabled={model.busy}
        />
      )}
      <NativeButton
        label="Apply approved changes"
        onPress={model.apply}
        disabled={
          model.busy ||
          (model.preview.changes.some((change) => change.destructive) && !model.allowDeletion)
        }
      />
    </View>
  );
}
export function NativeAgentHandoverPanel(props: AgentHandoverProps) {
  const model = useAgentHandover(props);
  return (
    <View className="gap-4">
      <Text className="text-recall-muted">
        Copy context to any external AI. Discuss it there, say “prepare changes”, then paste its
        JSON here. No connected AI account is required.
      </Text>
      <Text accessibilityRole="header" className="font-bold text-recall-ink">
        Copy for external AI · {model.area?.title}
      </Text>
      <NativeSelect
        label="Task"
        value={model.task}
        options={AGENT_TASKS}
        onValueChange={model.setTaskValue}
        disabled={model.busy}
      />
      <NativeTextField
        label="Your goal, question or mistaken answer"
        value={model.goal}
        onChangeText={model.setGoal}
        multiline
        maxLength={10_000}
        editable={!model.busy}
      />
      <Choice
        label="Include all cards in this deck"
        checked={model.allCards}
        onChange={model.setAllCards}
        disabled={model.busy}
      />
      {!model.allCards && (
        <View className="gap-3">
          <NativeTextField
            label="Find cards to include"
            value={model.cardQuery}
            onChangeText={model.setCardQuery}
            editable={!model.busy}
          />
          <Text className="text-recall-muted">
            Showing up to 100 matches. Search by question or card ID. {model.cardIds.length}{" "}
            selected.
          </Text>
          {model.cardChoices.map((card) => (
            <Choice
              key={card.id}
              label={card.front}
              checked={model.cardIds.includes(card.id)}
              onChange={() => {
                model.toggleCard(card.id);
              }}
              disabled={model.busy}
            />
          ))}
        </View>
      )}
      <Choice
        label={`Include recent conversation (${String(Math.min(20, props.conversation?.length ?? 0))} messages)`}
        checked={model.includeConversation}
        onChange={model.setIncludeConversation}
        disabled={model.busy || !props.conversation?.length}
      />
      <Choice
        label="Include recent review history (up to 20 ratings)"
        checked={model.includeReviews}
        onChange={model.setIncludeReviews}
        disabled={model.busy}
      />
      <Text className="text-recall-muted">
        Only selected card text, objectives and opted-in history are exported. Attachments and
        credentials are excluded. Inspect the handover before sharing.
      </Text>
      <NativeButton label="Prepare handover" onPress={model.build} disabled={model.busy} />
      {model.output && (
        <View className="gap-3">
          <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
            <Text testID="agent-handover-output" selectable className="text-xs text-recall-ink">
              {model.output}
            </Text>
          </ScrollView>
          <NativeButton
            label="Copy handover"
            onPress={() => {
              model.transfer("copy");
            }}
            disabled={model.busy}
          />
          <NativeButton
            label="Save or share JSON"
            variant="secondary"
            onPress={() => {
              model.transfer("save");
            }}
            disabled={model.busy}
          />
        </View>
      )}
      <Text accessibilityRole="header" className="font-bold text-recall-ink">
        Review AI changes
      </Text>
      <NativeTextField
        label="Paste the agent’s change-proposal JSON"
        value={model.input}
        onChangeText={model.setInput}
        multiline
        maxLength={MAX_AGENT_JSON_BYTES}
        editable={!model.busy}
      />
      <NativeButton
        label="Open JSON"
        variant="secondary"
        onPress={model.pick}
        disabled={model.busy}
      />
      <NativeButton
        label="Validate and preview"
        onPress={model.review}
        disabled={model.busy || !model.input.trim()}
      />
      <Preview model={model} />
      {model.status ? (
        <Text accessibilityLiveRegion="polite" className="text-recall-ink">
          {model.status}
        </Text>
      ) : null}
    </View>
  );
}
