import { useEffect, useRef } from "react";
import {
  presentLearningActivity,
  findActivityPlugin,
  type ActivityPresentation,
  type ActivityRegistry,
} from "@recall/application";
import type { ActivityLibrary, LearningActivity } from "@recall/domain";
import { Effect } from "effect";

type Run = <A>(
  operation: Effect.Effect<A, { readonly message: string }>,
  success: (value: A) => Promise<void> | void,
) => Promise<void>;

export type InitialAttemptDependencies = {
  readonly initialActivityId: string | undefined;
  readonly disabled: boolean;
  readonly busy: boolean;
  readonly activity: LearningActivity | null;
  readonly creating: boolean;
  readonly library: ActivityLibrary;
  readonly registry: ActivityRegistry;
  readonly platform: "web" | "native";
  readonly run: Run;
  readonly openAttempt: (entry: LearningActivity, content: ActivityPresentation) => void;
};

export function useLearningActivitiesInitialAttempt({
  initialActivityId,
  disabled,
  busy,
  activity,
  creating,
  library,
  registry,
  platform,
  run,
  openAttempt,
}: InitialAttemptDependencies): void {
  const openedInitial = useRef<string | null>(null);

  useEffect(() => {
    if (
      !initialActivityId ||
      disabled ||
      busy ||
      activity ||
      creating ||
      openedInitial.current === initialActivityId
    )
      return;
    const entry = library.activities.find(
      (candidate) => candidate.id === initialActivityId && !candidate.archived,
    );
    if (!entry || !findActivityPlugin(registry, entry)?.capabilities.platforms.includes(platform))
      return;
    openedInitial.current = initialActivityId;
    void run(presentLearningActivity(entry, registry), (content) => {
      openAttempt(entry, content);
    });
  }, [
    initialActivityId,
    disabled,
    busy,
    activity,
    creating,
    library.activities,
    registry,
    platform,
    run,
    openAttempt,
  ]);
}
