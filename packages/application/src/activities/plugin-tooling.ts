import { Effect, Schema } from "effect";
import { ActivityJsonSchema, LearningActivitySchema, type LearningActivity } from "@recall/domain";
import {
  builtinActivityRegistry,
  findActivityPlugin,
  upgradeLearningActivity,
  validateLearningActivity,
  type ActivityFailure,
  type ActivityPlugin,
  type ActivityRegistry,
} from "./learning-activities";

export type ActivityPluginPlatform = "web" | "native";
const pluginToolFailure = (
  reason: ActivityFailure["reason"],
  message: string,
): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason,
  message,
});
export type ActivityPluginCompatibility = {
  readonly compatible: boolean;
  readonly platform: ActivityPluginPlatform;
  readonly assessment: ActivityPlugin["capabilities"]["assessment"];
  readonly reasons: readonly string[];
};

export function decodeActivityPluginPayloadJson(
  input: string,
): Effect.Effect<unknown, ActivityFailure> {
  if (input.length > 100_000)
    return Effect.fail(
      pluginToolFailure("invalid-input", "Plugin payload exceeds its size limit."),
    );
  return Effect.try({
    try: () => JSON.parse(input) as unknown,
    catch: () => pluginToolFailure("invalid-input", "Plugin payload must be valid JSON."),
  }).pipe(
    Effect.flatMap((payload) =>
      Schema.decodeUnknown(Schema.Record({ key: Schema.String, value: ActivityJsonSchema }))(
        payload,
      ).pipe(
        Effect.mapError(() =>
          pluginToolFailure("invalid-input", "Plugin payload must be a bounded JSON object."),
        ),
      ),
    ),
  );
}

/** Capability declarations are display and validation data; they never load plugin code. */
export function inspectActivityPluginCompatibility(
  plugin: ActivityPlugin,
  platform: ActivityPluginPlatform,
  assessment: ActivityPlugin["capabilities"]["assessment"],
): ActivityPluginCompatibility {
  const reasons: string[] = [];
  if (!plugin.capabilities.platforms.includes(platform))
    reasons.push(`Unavailable on ${platform}.`);
  if (
    assessment !== plugin.capabilities.assessment &&
    !plugin.capabilities.assessmentMethods?.includes(assessment)
  )
    reasons.push(`Does not support ${assessment} assessment.`);
  return {
    compatible: reasons.length === 0,
    platform,
    assessment,
    reasons,
  };
}

/** Accepts only an activity envelope and payload validated by a trusted, already registered plugin. */
export function validateAuthoredActivity(
  input: unknown,
  platform: ActivityPluginPlatform,
  assessment: ActivityPlugin["capabilities"]["assessment"],
  registry: ActivityRegistry = builtinActivityRegistry,
): Effect.Effect<LearningActivity, ActivityFailure> {
  return validateLearningActivity(input, registry).pipe(
    Effect.flatMap((activity) => {
      const plugin = findActivityPlugin(registry, activity);
      if (!plugin)
        return Effect.fail(
          pluginToolFailure(
            "unsupported",
            "This plugin version is not installed. Imported activities cannot install code.",
          ),
        );
      const compatibility = inspectActivityPluginCompatibility(plugin, platform, assessment);
      return compatibility.compatible
        ? Effect.succeed(activity)
        : Effect.fail(pluginToolFailure("unsupported", compatibility.reasons.join(" ")));
    }),
  );
}

export type ActivityPluginMigrationPreview = {
  readonly source: LearningActivity;
  readonly proposal: LearningActivity;
  readonly fromVersion: number;
  readonly toVersion: number;
  readonly summary: string;
};
const ActivityPluginMigrationPreviewSchema = Schema.Struct({
  source: LearningActivitySchema,
  proposal: LearningActivitySchema,
  fromVersion: Schema.Number.pipe(Schema.int(), Schema.positive()),
  toVersion: Schema.Number.pipe(Schema.int(), Schema.positive()),
  summary: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1000)),
});

/** Builds a validated proposal. The caller must separately invoke applyActivityPluginMigration after approval. */
export function previewActivityPluginMigration(
  activityInput: unknown,
  targetVersion: number,
  registry: ActivityRegistry,
): Effect.Effect<ActivityPluginMigrationPreview, ActivityFailure> {
  return Effect.gen(function* () {
    const source = yield* Schema.decodeUnknown(LearningActivitySchema)(activityInput).pipe(
      Effect.mapError(() =>
        pluginToolFailure("invalid-input", "The activity envelope is invalid."),
      ),
    );
    const proposal = yield* upgradeLearningActivity(source, targetVersion, registry);
    return {
      source,
      proposal,
      fromVersion: source.pluginVersion,
      toVersion: proposal.pluginVersion,
      summary: `Review the version ${String(source.pluginVersion)} to ${String(proposal.pluginVersion)} content migration before applying it.`,
    };
  });
}

export function applyActivityPluginMigration(
  currentInput: unknown,
  previewInput: unknown,
  approved: boolean,
  registry: ActivityRegistry,
): Effect.Effect<LearningActivity, ActivityFailure> {
  return Effect.gen(function* () {
    if (!approved)
      return yield* Effect.fail(pluginToolFailure("conflict", "Migration was not approved."));
    const current = yield* Schema.decodeUnknown(LearningActivitySchema)(currentInput).pipe(
      Effect.mapError(() =>
        pluginToolFailure("invalid-input", "The current activity envelope is invalid."),
      ),
    );
    const preview = yield* Schema.decodeUnknown(ActivityPluginMigrationPreviewSchema)(
      previewInput,
    ).pipe(
      Effect.mapError(() =>
        pluginToolFailure("invalid-input", "The migration preview is invalid."),
      ),
    );
    if (
      stableJson(current) !== stableJson(preview.source) ||
      preview.proposal.id !== current.id ||
      preview.proposal.revision !== current.revision + 1 ||
      preview.proposal.pluginId !== current.pluginId ||
      preview.proposal.pluginVersion !== preview.toVersion
    )
      return yield* Effect.fail(
        pluginToolFailure(
          "conflict",
          "The activity changed after this migration preview. Preview it again.",
        ),
      );
    const approvedProposal = yield* upgradeLearningActivity(current, preview.toVersion, registry);
    if (stableJson(approvedProposal) !== stableJson(preview.proposal))
      return yield* Effect.fail(
        pluginToolFailure("conflict", "The migration proposal changed. Review a fresh preview."),
      );
    return approvedProposal;
  });
}

function stableJson(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(stableJson).join(",")}]`;
  if (input !== null && typeof input === "object")
    return `{${Object.entries(input)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, value]) => `${JSON.stringify(key)}:${stableJson(value)}`)
      .join(",")}}`;
  return JSON.stringify(input);
}

export type UnsupportedActivityExport = {
  readonly activity: LearningActivity;
  readonly json: string;
  readonly fallback: string;
  readonly pluginId: string;
  readonly pluginVersion: number;
};

/** Keeps the complete validated payload when its implementation is unavailable. */
export function exportUnsupportedActivity(
  input: unknown,
  registry: ActivityRegistry = builtinActivityRegistry,
): Effect.Effect<UnsupportedActivityExport, ActivityFailure> {
  return Schema.decodeUnknown(LearningActivitySchema)(input).pipe(
    Effect.mapError(() =>
      pluginToolFailure("invalid-input", "The activity envelope cannot be exported safely."),
    ),
    Effect.flatMap((activity) =>
      findActivityPlugin(registry, activity)
        ? Effect.fail(
            pluginToolFailure(
              "unsupported",
              "This activity has an installed plugin and does not need fallback export.",
            ),
          )
        : Effect.try({
            try: () => ({
              activity,
              json: JSON.stringify(activity, null, 2),
              fallback: activity.fallback,
              pluginId: activity.pluginId,
              pluginVersion: activity.pluginVersion,
            }),
            catch: () =>
              pluginToolFailure("invalid-input", "The activity cannot be encoded for export."),
          }),
    ),
  );
}
