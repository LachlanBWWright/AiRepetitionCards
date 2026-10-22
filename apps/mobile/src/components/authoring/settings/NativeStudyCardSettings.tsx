import { Text, View } from "react-native";
import type { Assessment, SchedulerSettings, Workspace } from "@recall/domain";
import { studyCardStatus, suspensionSettings } from "@recall/application";
import { NativeButton } from "../../ui/NativeButton";

export function NativeStudyCardSettings({
  workspace,
  settings,
  disabled,
  onChange,
}: {
  readonly workspace: Workspace;
  readonly settings: SchedulerSettings;
  readonly disabled: boolean;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const draft = { ...workspace, schedulerSettings: settings };
  const cards = workspace.areas.flatMap((area) =>
    area.cards.map((card) => ({ areaId: area.id, card })),
  );
  return (
    <View className="gap-3 border-t border-recall-line pt-3">
      <Text className="font-bold text-recall-ink">Cards needing attention</Text>
      <Text className="text-sm text-recall-muted">
        Repeated failures are flagged, never suspended automatically. Edit these cards in Library or
        suspend them here. History is preserved.
      </Text>
      {cards
        .filter(({ card, areaId }) => {
          const status = studyCardStatus(draft, card, areaId);
          return status.leech || status.suspended;
        })
        .map(({ card, areaId }) => {
          return (
            <NativeStudyCardRow
              key={card.id}
              card={card}
              areaId={areaId}
              workspace={draft}
              settings={settings}
              disabled={disabled}
              onChange={onChange}
            />
          );
        })}
    </View>
  );
}

function NativeStudyCardRow({
  card,
  areaId,
  workspace,
  settings,
  disabled,
  onChange,
}: {
  readonly card: Assessment;
  readonly areaId: string;
  readonly workspace: Workspace;
  readonly settings: SchedulerSettings;
  readonly disabled: boolean;
  readonly onChange: (settings: SchedulerSettings) => void;
}) {
  const status = studyCardStatus(workspace, card, areaId);
  const toggle = () => {
    onChange(suspensionSettings({ ...workspace, schedulerSettings: settings }, card.id));
  };
  return (
    <View className="gap-2 border-b border-recall-line pb-3">
      <Text>
        {card.front.slice(0, 150)} · {status.lapses} lapses{status.suspended ? " · suspended" : ""}
      </Text>
      <NativeButton
        label={status.suspended ? "Resume on save" : "Suspend on save"}
        tone="soft"
        disabled={disabled}
        onPress={toggle}
      />
    </View>
  );
}
