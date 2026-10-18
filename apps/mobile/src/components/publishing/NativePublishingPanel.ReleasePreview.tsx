import { Effect, Either } from "effect";
import { previewRelease } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import { Text, View } from "react-native";

type NativePublishingPanelReleasePreviewProps = {
  readonly previousRelease: KnowledgeArea | null;
  readonly releaseContent: KnowledgeArea | null;
};

export function NativePublishingPanelReleasePreview({
  previousRelease,
  releaseContent,
}: NativePublishingPanelReleasePreviewProps) {
  const releasePreview =
    releaseContent && previousRelease
      ? Effect.runSync(Effect.either(previewRelease(previousRelease, releaseContent)))
      : null;
  if (!releasePreview || Either.isLeft(releasePreview)) return null;
  return (
    <View
      accessibilityLabel="Changes since previous release"
      className="gap-1 rounded-xl border border-recall-line p-3"
    >
      <Text className="font-bold text-recall-ink">Changes since the previous release</Text>
      <Text className="text-xs text-recall-muted">
        Cards: +{releasePreview.right.diff.cards.added.length} · ~
        {releasePreview.right.diff.cards.changed.length} · −
        {releasePreview.right.diff.cards.removed.length}
        {"\n"}Activities: +{releasePreview.right.diff.activities.added.length} · ~
        {releasePreview.right.diff.activities.changed.length} · −
        {releasePreview.right.diff.activities.removed.length}
        {"\n"}Objectives: +{releasePreview.right.diff.objectives.added.length} · ~
        {releasePreview.right.diff.objectives.changed.length} · −
        {releasePreview.right.diff.objectives.removed.length}
      </Text>
      {releasePreview.right.diff.metadata.map((change) => (
        <Text key={change.field} className="text-xs text-recall-ink">
          {change.field}: {JSON.stringify(change.before)} → {JSON.stringify(change.after)}
        </Text>
      ))}
      {releasePreview.right.diff.cards.added.map((card) => (
        <Text key={`added-${card.id}`} className="text-xs text-recall-ink">
          Card added: {card.kind === "basic" ? `${card.front} → ${card.back}` : card.text}
        </Text>
      ))}
      {releasePreview.right.diff.cards.changed.map(({ before, after }) => (
        <Text key={`changed-${after.id}`} className="text-xs text-recall-ink">
          Card changed: {JSON.stringify(before)} → {JSON.stringify(after)}
        </Text>
      ))}
      {releasePreview.right.diff.cards.removed.map((card) => (
        <Text key={`removed-${card.id}`} className="text-xs text-recall-ink">
          Card removed: {card.kind === "basic" ? `${card.front} → ${card.back}` : card.text}
        </Text>
      ))}
      {releasePreview.right.diff.objectives.added.map((objective) => (
        <Text key={`objective-added-${objective.id}`} className="text-xs text-recall-ink">
          Objective added: {objective.title} — {objective.description ?? ""}
        </Text>
      ))}
      {releasePreview.right.diff.objectives.changed.map(({ before, after }) => (
        <Text key={`objective-changed-${after.id}`} className="text-xs text-recall-ink">
          Objective changed: {JSON.stringify(before)} → {JSON.stringify(after)}
        </Text>
      ))}
      {releasePreview.right.diff.objectives.removed.map((objective) => (
        <Text key={`objective-removed-${objective.id}`} className="text-xs text-recall-ink">
          Objective removed: {objective.title} — {objective.description ?? ""}
        </Text>
      ))}
      {releasePreview.right.diff.activities.added.map((activity) => (
        <Text key={`activity-added-${activity.id}`} className="text-xs text-recall-ink">
          Activity added: {activity.title} · {JSON.stringify(activity.payload)}
        </Text>
      ))}
      {releasePreview.right.diff.activities.changed.map(({ before, after }) => (
        <Text key={`activity-changed-${after.id}`} className="text-xs text-recall-ink">
          Activity changed: {JSON.stringify(before)} → {JSON.stringify(after)}
        </Text>
      ))}
      {releasePreview.right.diff.activities.removed.map((activity) => (
        <Text key={`activity-removed-${activity.id}`} className="text-xs text-recall-ink">
          Activity removed: {activity.title} · {JSON.stringify(activity.payload)}
        </Text>
      ))}
      {releasePreview.right.warnings.map((warning) => (
        <Text key={warning} className="text-xs text-amber-800">
          {warning}
        </Text>
      ))}
    </View>
  );
}
