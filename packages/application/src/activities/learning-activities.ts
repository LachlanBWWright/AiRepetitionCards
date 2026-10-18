import { Effect, Schema } from "effect";
import { buildAuthoredLearningActivity } from "./learning-activities-authoring";
import { mergeLibraries } from "./learning-activities-merge";
import { stable } from "./learning-activities-stable";
import {
  ActivityLibrarySchema,
  ActivityResponseSchema,
  ActivityResultSchema,
  LearningActivitySchema,
  LearningAttemptSchema,
  type ActivityLibrary,
  type ActivityResult,
  type LearningActivity,
} from "@recall/domain";

import {
  failure,
  type ActivityFailure,
  type ActivityPlugin,
  type ActivityRegistry,
  type ActivityPresentation,
  builtinActivityRegistry,
  findActivityPlugin,
} from "./learning-activities-plugins";
export {
  type ActivityFailure,
  type ActivityPlugin,
  type ActivityRegistry,
  type ActivityPresentation,
  builtinActivityRegistry,
  findActivityPlugin,
} from "./learning-activities-plugins";
function boundedJson(input: unknown, maximum: number): Effect.Effect<void, ActivityFailure> {
  return Effect.try({
    try: () => JSON.stringify(input),
    catch: () => failure("invalid-input", "Activity data must be bounded JSON."),
  }).pipe(
    Effect.flatMap((encoded) =>
      typeof encoded === "string" && encoded.length <= maximum
        ? Effect.void
        : Effect.fail(failure("invalid-input", "Activity data exceeds its size limit.")),
    ),
  );
}
export function validateLearningActivity(
  input: unknown,
  registry: ActivityRegistry = builtinActivityRegistry,
) {
  return boundedJson(input, 120_000).pipe(
    Effect.flatMap(() => Schema.decodeUnknown(LearningActivitySchema)(input)),
    Effect.mapError(() => failure("invalid-input", "The activity envelope is invalid.")),
    Effect.flatMap((activity) => {
      const plugin = findActivityPlugin(registry, activity);
      return plugin
        ? plugin.present(activity.payload).pipe(Effect.as(activity))
        : Effect.fail(
            failure("unsupported", "This activity requires a plugin version that is unavailable."),
          );
    }),
  );
}
export function assessLearningActivity(
  activityInput: unknown,
  responseInput: unknown,
  registry: ActivityRegistry = builtinActivityRegistry,
): Effect.Effect<ActivityResult, ActivityFailure> {
  return Effect.gen(function* () {
    const activity = yield* validateLearningActivity(activityInput, registry);
    const response = yield* Schema.decodeUnknown(ActivityResponseSchema)(responseInput).pipe(
      Effect.mapError(() => failure("invalid-input", "The response is invalid.")),
    );
    const plugin = findActivityPlugin(registry, activity);
    if (!plugin)
      return yield* Effect.fail(failure("unsupported", "The required plugin is unavailable."));
    const raw = yield* plugin.assess(activity, response);
    const result = yield* Schema.decodeUnknown(ActivityResultSchema)(raw).pipe(
      Effect.mapError(() => failure("invalid-input", "The evaluator returned invalid evidence.")),
    );
    if (
      result.evidence.some(
        (evidence) =>
          !activity.objectiveIds.includes(evidence.objectiveId) ||
          evidence.assistance !== response.assistance ||
          !(plugin.capabilities.assessmentMethods ?? [plugin.capabilities.assessment]).includes(
            evidence.assessment,
          ),
      ) ||
      new Set(result.evidence.map((evidence) => `${evidence.objectiveId}:${evidence.dimension}`))
        .size !== result.evidence.length
    )
      return yield* Effect.fail(
        failure(
          "invalid-input",
          "The evaluator returned evidence outside this activity's objectives or assessment contract.",
        ),
      );
    return result;
  });
}
/** Acceptance records an immutable snapshot; changing content later never changes old evidence. */
export function acceptLearningAttempt(
  library: ActivityLibrary,
  input: unknown,
  registry: ActivityRegistry = builtinActivityRegistry,
): Effect.Effect<ActivityLibrary, ActivityFailure> {
  return Effect.gen(function* () {
    yield* boundedJson(input, 500_000);
    const attempt = yield* Schema.decodeUnknown(LearningAttemptSchema)(input).pipe(
      Effect.mapError(() => failure("invalid-input", "The attempt is invalid.")),
    );
    if (
      attempt.result.evidence.some(
        (entry) =>
          !attempt.activity.objectiveIds.includes(entry.objectiveId) ||
          entry.assistance !== attempt.response.assistance,
      )
    )
      return yield* Effect.fail(
        failure("invalid-input", "Attempt evidence must belong to the activity and response."),
      );
    yield* validateLearningActivity(attempt.activity, registry);
    const plugin = findActivityPlugin(registry, attempt.activity);
    if (
      !plugin ||
      attempt.result.evidence.some(
        (entry) =>
          !(plugin.capabilities.assessmentMethods ?? [plugin.capabilities.assessment]).includes(
            entry.assessment,
          ),
      ) ||
      new Set(attempt.result.evidence.map((entry) => `${entry.objectiveId}:${entry.dimension}`))
        .size !== attempt.result.evidence.length
    )
      return yield* Effect.fail(
        failure(
          "invalid-input",
          "The accepted result does not match the activity's assessment contract.",
        ),
      );
    const existing = library.attempts.find((entry) => entry.id === attempt.id);
    if (existing)
      return stable(existing) === stable(attempt)
        ? library
        : yield* Effect.fail(failure("conflict", "This attempt identifier has already been used."));
    const current = library.activities.find((entry) => entry.id === attempt.activity.id);
    if (!current || current.archived || stable(current) !== stable(attempt.activity))
      return yield* Effect.fail(
        failure(
          "conflict",
          "The activity changed. Start a new attempt against the current version.",
        ),
      );
    return yield* Schema.decodeUnknown(ActivityLibrarySchema)({
      ...library,
      attempts: [...library.attempts, attempt],
      drafts: (library.drafts ?? []).filter((draft) => draft.id !== attempt.id),
    }).pipe(
      Effect.mapError(() =>
        failure("invalid-input", "The activity library has reached its storage limit."),
      ),
    );
  });
}
export function addLearningActivity(
  library: ActivityLibrary,
  input: unknown,
  registry: ActivityRegistry = builtinActivityRegistry,
): Effect.Effect<ActivityLibrary, ActivityFailure> {
  return validateLearningActivity(input, registry).pipe(
    Effect.flatMap((activity) => {
      const existing = library.activities.find((entry) => entry.id === activity.id);
      if (existing)
        return stable(existing) === stable(activity)
          ? Effect.succeed(library)
          : Effect.fail(failure("conflict", "This activity already exists."));
      return Schema.decodeUnknown(ActivityLibrarySchema)({
        ...library,
        activities: [...library.activities, activity],
      }).pipe(
        Effect.mapError(() =>
          failure("invalid-input", "The activity library has reached its storage limit."),
        ),
      );
    }),
  );
}
export { summarizeUnderstanding, activityFromCard } from "./learning-activities-summary";
export function presentLearningActivity(
  activity: LearningActivity,
  registry: ActivityRegistry = builtinActivityRegistry,
): Effect.Effect<ActivityPresentation, ActivityFailure> {
  const plugin = findActivityPlugin(registry, activity);
  return plugin
    ? plugin.present(activity.payload)
    : Effect.fail(
        failure(
          "unsupported",
          "This plugin version is unavailable. Your content and history are preserved.",
        ),
      );
}
export const decodeActivityLibrary = (input: unknown) =>
  boundedJson(input, 5_000_000).pipe(
    Effect.flatMap(() => Schema.decodeUnknown(ActivityLibrarySchema)(input)),
    Effect.mapError(() => failure("invalid-input", "The activity library is invalid.")),
  );

export {
  activityAuthoringFields,
  type ActivityAuthoringField,
} from "./learning-activities-authoring";
export function authorLearningActivity(
  input: {
    readonly id: string;
    readonly areaId: string;
    readonly title: string;
    readonly pluginId: string;
    readonly objectiveId: string;
    readonly fields: Readonly<Record<string, string>>;
  },
  registry: ActivityRegistry = builtinActivityRegistry,
): Effect.Effect<LearningActivity, ActivityFailure> {
  return buildAuthoredLearningActivity(input, (activity) =>
    validateLearningActivity(activity, registry),
  );
}

/** Explicit upgrades create a content revision; old attempt snapshots remain untouched. */
export function upgradeLearningActivity(
  input: unknown,
  targetVersion: number,
  registry: ActivityRegistry,
): Effect.Effect<LearningActivity, ActivityFailure> {
  return Effect.gen(function* () {
    yield* boundedJson(input, 120_000);
    const activity = yield* Schema.decodeUnknown(LearningActivitySchema)(input).pipe(
      Effect.mapError(() => failure("invalid-input", "The activity envelope is invalid.")),
    );
    if (targetVersion === activity.pluginVersion)
      return yield* validateLearningActivity(activity, registry);
    if (!Number.isSafeInteger(targetVersion) || targetVersion <= activity.pluginVersion)
      return yield* Effect.fail(failure("invalid-input", "Choose a newer plugin version."));
    const target = findActivityPlugin(registry, { ...activity, pluginVersion: targetVersion });
    if (!target?.migrate)
      return yield* Effect.fail(
        failure("unsupported", "This plugin has no migration from the stored version."),
      );
    const payload = yield* target.migrate(activity.payload, activity.pluginVersion);
    return yield* validateLearningActivity(
      { ...activity, payload, pluginVersion: targetVersion, revision: activity.revision + 1 },
      registry,
    );
  });
}

/** Content revisions may advance; accepted evidence is a union of immutable identities. */
export function mergeActivityLibraries(localInput: unknown, remoteInput: unknown) {
  return mergeLibraries(localInput, remoteInput, decodeActivityLibrary);
}
export function reviseLearningActivity(
  library: ActivityLibrary,
  input: unknown,
  expectedRevision: number,
  registry: ActivityRegistry = builtinActivityRegistry,
): Effect.Effect<ActivityLibrary, ActivityFailure> {
  return validateLearningActivity(input, registry).pipe(
    Effect.flatMap((activity) => {
      const existing = library.activities.find((entry) => entry.id === activity.id);
      if (existing && stable(existing) === stable(activity)) return Effect.succeed(library);
      if (
        !existing ||
        existing.revision !== expectedRevision ||
        activity.revision !== expectedRevision + 1
      )
        return Effect.fail(failure("conflict", "This activity changed. Reload it before editing."));
      return decodeActivityLibrary({
        ...library,
        activities: library.activities.map((entry) =>
          entry.id === activity.id ? activity : entry,
        ),
      });
    }),
  );
}
export function recommendLearningActivities(library: ActivityLibrary, areaId: string, now: number) {
  return library.activities
    .filter((activity) => activity.areaId === areaId && !activity.archived)
    .map((activity) => {
      const attempts = library.attempts
        .filter(
          (attempt) =>
            attempt.activity.id === activity.id && attempt.activity.revision === activity.revision,
        )
        .sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt, "en"));
      const latest = attempts.at(-1);
      const failed = latest?.result.evidence.some((entry) => entry.score < 0.7) ?? false;
      const assisted =
        latest?.response.assistance !== undefined && latest.response.assistance !== "none";
      const tentative =
        latest?.result.evidence.every(
          (entry) => entry.assessment === "self" || entry.confidence < 0.7,
        ) ?? false;
      const ageDays = latest ? Math.max(0, (now - Date.parse(latest.acceptedAt)) / 86_400_000) : 0;
      return {
        activity,
        priority: !latest
          ? 100
          : failed
            ? 90
            : assisted
              ? 80
              : tentative
                ? 70
                : Math.min(60, ageDays),
        reason: !latest
          ? "No attempt yet"
          : failed
            ? "Revisit a gap in your last attempt"
            : assisted
              ? "Try independently after using help"
              : tentative
                ? "Seek independent evidence for this objective"
                : "Test retention in a new context",
        estimatedMinutes:
          activity.pluginId === "recall.coding"
            ? 15
            : activity.pluginId === "recall.interrogation"
              ? 10
              : 3,
      };
    })
    .sort((a, b) => b.priority - a.priority || a.activity.id.localeCompare(b.activity.id, "en"));
}

/** Register implementations at composition time; content never installs executable plugins. */
export function registerActivityPlugins(
  plugins: readonly ActivityPlugin[],
): Effect.Effect<ActivityRegistry, ActivityFailure> {
  const identities = plugins.map((plugin) => `${plugin.id}@${String(plugin.version)}`);
  if (
    new Set(identities).size !== identities.length ||
    plugins.some(
      (plugin) =>
        !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+$/.test(plugin.id) ||
        !Number.isSafeInteger(plugin.version) ||
        plugin.version < 1 ||
        plugin.capabilities.platforms.length === 0,
    )
  )
    return Effect.fail(
      failure(
        "invalid-input",
        "Plugins need namespaced identities, positive versions, supported platforms, and unique registrations.",
      ),
    );
  return Effect.succeed([...plugins]);
}
