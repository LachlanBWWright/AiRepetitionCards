import { Text, View } from "react-native";
import type { AppModel } from "../useAppController";
export function AppSubjectProgress({ model }: { readonly model: AppModel }) {
  const events = (model.workspace?.reviewEvents ?? []).filter(
    (event) => event.areaId === model.activeAreaId,
  );
  const recent = [...events]
    .sort((left, right) => right.ratedAt.localeCompare(left.ratedAt))
    .slice(0, 20);
  return (
    <View className="gap-3">
      <Text className="text-lg font-bold text-recall-ink">
        {events.length} reviews in this subject
      </Text>
      {recent.map((event) => (
        <View key={event.id} className="gap-1 border-b border-recall-line py-3">
          <Text className="text-recall-ink">
            {model.activeArea?.cards.find((card) => card.id === event.cardId)?.front ??
              "Removed card"}
          </Text>
          <Text className="text-recall-muted">
            {event.rating} · {new Date(event.ratedAt).toLocaleString()}
          </Text>
        </View>
      ))}
      {recent.length === 0 && (
        <Text className="text-recall-muted">
          Your review history will appear here after you study.
        </Text>
      )}
    </View>
  );
}
