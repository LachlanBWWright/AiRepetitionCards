import { useState } from "react";
import { View } from "react-native";
import {
  NativeTodayScreenReviewCard,
  type NativeTodayScreenReviewCardProps,
} from "../NativeTodayScreenReviewCard";
import { NativeReviewLearningActivities } from "./NativeReviewLearningActivities";
import type { LearningActivitiesProps } from "../../../hooks/use-learning-activities";

export function NativeReviewActivityCard({
  activities,
  ...props
}: NativeTodayScreenReviewCardProps & { readonly activities?: LearningActivitiesProps }) {
  const [state, setState] = useState<{
    readonly cardId: string;
    readonly open: boolean;
    readonly accepted: boolean;
  } | null>(null);
  const current = state?.cardId === props.card.id ? state : null;
  return (
    <View>
      <NativeTodayScreenReviewCard
        {...props}
        automationPaused={Boolean(props.automationPaused || current?.open || current?.accepted)}
        interactionPaused={Boolean(props.interactionPaused || current?.open)}
      />
      {activities && (
        <NativeReviewLearningActivities
          key={props.card.id}
          {...activities}
          disabled={Boolean(activities.disabled || props.interactionPaused)}
          card={props.card}
          onOpenChange={(open) => {
            setState((previous) => ({
              cardId: props.card.id,
              open,
              accepted: previous?.cardId === props.card.id && previous.accepted,
            }));
          }}
          onAccepted={() => {
            setState((previous) => ({
              cardId: props.card.id,
              open: previous?.cardId === props.card.id && previous.open,
              accepted: true,
            }));
          }}
          onReturn={props.onShowAnswer}
        />
      )}
    </View>
  );
}
