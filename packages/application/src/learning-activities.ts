import { Effect, Schema } from "effect";
import {
  CodingPayloadSchema,
  ActivityLibrarySchema,
  ActivityResponseSchema,
  ActivityResultSchema,
  LearningActivitySchema,
  LearningAttemptSchema,
  type ActivityLibrary,
  type ActivityResponse,
  type ActivityResult,
  type LearningActivity,
  type LearningAttempt,
  type Assessment,
  type UnderstandingEvidence,
} from "@recall/domain";

export type ActivityFailure = {
  readonly _tag: "ActivityFailure";
  readonly reason: "invalid-input" | "unsupported" | "assessment-unavailable" | "conflict";
  readonly message: string;
};
const failure = (reason: ActivityFailure["reason"], message: string): ActivityFailure => ({
  _tag: "ActivityFailure",
  reason,
  message,
});
const text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000));
const prompts = Schema.Array(text).pipe(Schema.minItems(1), Schema.maxItems(10));
const RubricPayload = Schema.Struct({
  prompts,
  rubric: text,
  reference: Schema.String.pipe(Schema.maxLength(20_000)),
});
const ChoicePayload = Schema.Struct({
  prompt: text,
  options: Schema.Array(
    Schema.Struct({ id: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)), text }),
  ).pipe(Schema.minItems(2), Schema.maxItems(8)),
  correctOptionIds: Schema.Array(
    Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200)),
  ).pipe(Schema.minItems(1), Schema.maxItems(8)),
  explanation: text,
}).pipe(
  Schema.filter(
    (content) =>
      new Set(content.options.map((option) => option.id)).size === content.options.length &&
      new Set(content.correctOptionIds).size === content.correctOptionIds.length &&
      content.correctOptionIds.every((id) => content.options.some((option) => option.id === id)),
  ),
);
export type ActivityPresentation = {
  readonly prompts: readonly string[];
  readonly options: readonly { readonly id: string; readonly text: string }[];
  readonly rubric: string;
  readonly reference: string;
  readonly code: boolean;
};
/** Plugins are trusted registrations. Imported activity payloads cannot register implementations. */
export type ActivityPlugin = {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly capabilities: {
    readonly offline: boolean;
    readonly execution: boolean;
    readonly assessment: "self" | "deterministic" | "ai" | "human";
    readonly assessmentMethods?: readonly UnderstandingEvidence["assessment"][];
    readonly platforms: readonly ("web" | "native")[];
  };
  readonly migrate?: (
    payload: unknown,
    fromVersion: number,
  ) => Effect.Effect<unknown, ActivityFailure>;
  readonly present: (payload: unknown) => Effect.Effect<ActivityPresentation, ActivityFailure>;
  readonly assess: (
    activity: LearningActivity,
    response: ActivityResponse,
  ) => Effect.Effect<unknown, ActivityFailure>;
};
export type ActivityRegistry = readonly ActivityPlugin[];
const decodeRubric = (input: unknown) =>
  Schema.decodeUnknown(RubricPayload)(input).pipe(
    Effect.mapError(() =>
      failure("invalid-input", "This activity needs valid prompts, a rubric, and reference text."),
    ),
  );
const decodeChoice = (input: unknown) =>
  Schema.decodeUnknown(ChoicePayload)(input).pipe(
    Effect.mapError(() =>
      failure("invalid-input", "Multiple choice needs unique choices and valid correct choices."),
    ),
  );
function rubricPlugin(
  id: string,
  label: string,
  dimension: UnderstandingEvidence["dimension"],
  code = false,
): ActivityPlugin {
  return {
    id,
    version: 1,
    label,
    capabilities: {
      offline: true,
      execution: false,
      assessment: "self",
      assessmentMethods: code ? ["self", "ai", "deterministic"] : ["self", "ai"],
      platforms: ["web", "native"],
    },
    present: (input) =>
      (code && typeof input === "object" && input !== null && "tests" in input
        ? Schema.decodeUnknown(CodingPayloadSchema)(input).pipe(
            Effect.mapError(() =>
              failure(
                "invalid-input",
                "Coding tests must contain JSON inputs and expected values.",
              ),
            ),
          )
        : decodeRubric(input)
      ).pipe(Effect.map((content) => ({ ...content, options: [], code }))),
    assess: (activity, response) =>
      decodeRubric(activity.payload).pipe(
        Effect.flatMap((content) => {
          if (
            response.answers.length !== (response.presentedPrompts ?? content.prompts).length ||
            (response.presentedPrompts !== undefined &&
              (response.presentedPrompts.length < content.prompts.length ||
                (id !== "recall.interrogation" &&
                  response.presentedPrompts.length !== content.prompts.length) ||
                content.prompts.some(
                  (prompt, index) => response.presentedPrompts?.[index] !== prompt,
                ))) ||
            response.answers.some((answer) => !answer.trim()) ||
            response.selectedOptionIds.length > 0
          )
            return Effect.fail(
              failure("invalid-input", "Answer each prompt before assessing your work."),
            );
          return Effect.succeed({
            evaluatorId: `${id}:self-rubric`,
            evaluatorVersion: "1",
            feedback:
              "Self-assessment recorded against the rubric. This does not independently verify understanding.",
            evidence: activity.objectiveIds.map((objectiveId) => ({
              objectiveId,
              dimension,
              score: response.selfScore,
              confidence: 0.4,
              assistance: response.assistance,
              assessment: "self" as const,
              explanation: content.rubric,
            })),
          });
        }),
      ),
  };
}
export const builtinActivityRegistry: ActivityRegistry = [
  rubricPlugin("recall.basic", "Recall", "recall"),
  rubricPlugin("recall.cloze", "Cloze", "recall"),
  rubricPlugin("recall.short-answer", "Short answer", "reasoning"),
  rubricPlugin("recall.coding", "Coding exercise", "application", true),
  rubricPlugin("recall.interrogation", "Structured interrogation", "reasoning"),
  {
    id: "recall.multiple-choice",
    version: 1,
    label: "Multiple choice",
    capabilities: {
      offline: true,
      execution: false,
      assessment: "deterministic",
      platforms: ["web", "native"],
    },
    present: (input) =>
      decodeChoice(input).pipe(
        Effect.map((content) => ({
          prompts: [content.prompt],
          options: content.options,
          rubric: "Select every correct choice. Full credit requires an exact match.",
          reference: content.explanation,
          code: false,
        })),
      ),
    assess: (activity, response) =>
      decodeChoice(activity.payload).pipe(
        Effect.flatMap((content) => {
          const selected = new Set(response.selectedOptionIds);
          if (
            selected.size === 0 ||
            selected.size !== response.selectedOptionIds.length ||
            [...selected].some((id) => !content.options.some((option) => option.id === id)) ||
            response.answers.length > 0
          )
            return Effect.fail(failure("invalid-input", "Select valid choices before submitting."));
          const correct =
            selected.size === content.correctOptionIds.length &&
            content.correctOptionIds.every((id) => selected.has(id));
          return Effect.succeed({
            evaluatorId: "recall.multiple-choice:exact-match",
            evaluatorVersion: "1",
            feedback: `${correct ? "Correct." : "Not quite."} ${content.explanation}`,
            evidence: activity.objectiveIds.map((objectiveId) => ({
              objectiveId,
              dimension: "recognition" as const,
              score: correct ? 1 : 0,
              confidence: 1,
              assistance: response.assistance,
              assessment: "deterministic" as const,
              explanation:
                "Exact-match recognition result; a correct selection can still be guessed.",
            })),
          });
        }),
      ),
  },
];
export function findActivityPlugin(
  registry: ActivityRegistry,
  activity: LearningActivity,
): ActivityPlugin | undefined {
  const matches = registry.filter(
    (plugin) => plugin.id === activity.pluginId && plugin.version === activity.pluginVersion,
  );
  return matches.length === 1 ? matches[0] : undefined;
}
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
/** Self reports and assisted responses remain separate from independent evidence. No mastery claim. */
export function summarizeUnderstanding(attempts: readonly LearningAttempt[], objectiveId: string) {
  const entries = attempts.flatMap((attempt) =>
    attempt.result.evidence.filter((entry) => entry.objectiveId === objectiveId),
  );
  const dimensions = ["recall", "recognition", "reasoning", "application", "transfer"] as const;
  return dimensions.map((dimension) => {
    const evidence = entries.filter((entry) => entry.dimension === dimension);
    const independent = evidence.filter(
      (entry) => entry.assessment !== "self" && entry.assistance === "none",
    );
    const weight = independent.reduce((total, entry) => total + entry.confidence, 0);
    return {
      dimension,
      attempts: evidence.length,
      selfReports: evidence.filter((entry) => entry.assessment === "self").length,
      assisted: evidence.filter((entry) => entry.assistance !== "none").length,
      value:
        weight > 0
          ? independent.reduce((total, entry) => total + entry.score * entry.confidence, 0) / weight
          : null,
    };
  });
}
export function activityFromCard(card: Assessment, areaId: string): LearningActivity {
  return {
    id: `card:${card.id}`,
    areaId,
    title: card.front.slice(0, 300),
    pluginId: card.cloze ? "recall.cloze" : "recall.basic",
    pluginVersion: 1,
    revision: 1,
    objectiveIds: card.objectiveIds?.length ? card.objectiveIds : [`card-objective:${card.id}`],
    fallback: card.front,
    payload: {
      prompts: [card.front],
      rubric: "Compare your unaided answer with the reference answer.",
      reference: card.back,
    },
  };
}
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

export type ActivityAuthoringField = {
  readonly key: string;
  readonly label: string;
  readonly initial: string;
  readonly multiline: boolean;
};
export function activityAuthoringFields(pluginId: string): readonly ActivityAuthoringField[] {
  if (pluginId === "recall.multiple-choice")
    return [
      {
        key: "prompt",
        label: "Question",
        initial: "Which data structure follows first-in, first-out order?",
        multiline: true,
      },
      {
        key: "options",
        label: "Choices (one per line)",
        initial: "Stack\nQueue\nSet",
        multiline: true,
      },
      {
        key: "correct",
        label: "Correct choice numbers (comma separated)",
        initial: "2",
        multiline: false,
      },
      {
        key: "reference",
        label: "Feedback",
        initial: "A queue removes elements in the order they were added.",
        multiline: true,
      },
    ];
  const interrogation = pluginId === "recall.interrogation";
  const coding = pluginId === "recall.coding";
  return [
    {
      key: "prompt",
      label: interrogation ? "Question stages (separate with a blank line)" : "Prompt",
      initial: interrogation
        ? "Explain what a queue does.\n\nWhy is a queue suitable for a breadth-first search?\n\nDescribe a different real-world use for a queue."
        : coding
          ? "Write a JavaScript function solve(values) that returns the sum of an array of numbers. Include how you would test empty and negative inputs, and explain its complexity."
          : "Explain how a queue differs from a stack.",
      multiline: true,
    },
    {
      key: "rubric",
      label: "Assessment rubric",
      initial: coding
        ? "Correctly sums every element, returns zero for an empty array, handles negative numbers, and explains O(n) time and O(1) extra space."
        : "An accurate explanation, a justified example, and an application in a new context.",
      multiline: true,
    },
    {
      key: "reference",
      label: "Reference answer (optional)",
      initial: coding
        ? "function solve(values) { return values.reduce((total, value) => total + value, 0); }"
        : "A queue is FIFO; a stack is LIFO. A queue supports breadth-first traversal by processing the earliest discovered nodes first.",
      multiline: true,
    },
    ...(coding
      ? [
          {
            key: "tests",
            label: "Test cases (JSON input arrays and expected values)",
            initial:
              '[{"input":[[1,2,3]],"expected":6},{"input":[[]],"expected":0},{"input":[[-2,1]],"expected":-1}]',
            multiline: true,
          },
        ]
      : []),
  ];
}
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
  const prompt = input.fields.prompt ?? "";
  const reference = input.fields.reference ?? "";
  const codingTests =
    input.pluginId === "recall.coding"
      ? Schema.decodeUnknownEither(Schema.parseJson(CodingPayloadSchema.fields.tests))(
          input.fields.tests ??
            '[{"input":[[1,2,3]],"expected":6},{"input":[[]],"expected":0},{"input":[[-2,1]],"expected":-1}]',
        )
      : null;
  if (codingTests && codingTests._tag === "Left")
    return Effect.fail(
      failure("invalid-input", "Tests must be JSON objects with input arrays and expected values."),
    );
  const payload =
    input.pluginId === "recall.multiple-choice"
      ? {
          prompt,
          options: (input.fields.options ?? "")
            .split("\n")
            .map((value, index) => ({ id: String(index + 1), text: value.trim() })),
          correctOptionIds: (input.fields.correct ?? "").split(",").map((value) => value.trim()),
          explanation: reference,
        }
      : {
          ...(codingTests ? { language: "javascript", tests: codingTests.right } : {}),
          prompts:
            input.pluginId === "recall.interrogation"
              ? prompt.split(/\n\s*\n/).map((value) => value.trim())
              : [prompt],
          rubric: input.fields.rubric ?? "",
          reference,
        };
  return validateLearningActivity(
    {
      id: input.id,
      areaId: input.areaId,
      title: input.title.trim(),
      pluginId: input.pluginId,
      pluginVersion: 1,
      revision: 1,
      objectiveIds: [input.objectiveId],
      fallback: prompt,
      payload,
    },
    registry,
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

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item: unknown) => stable(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
      .join(",")}}`;
  return value === undefined ? "null" : JSON.stringify(value);
}
/** Content revisions may advance; accepted evidence is a union of immutable identities. */
export function mergeActivityLibraries(
  localInput: unknown,
  remoteInput: unknown,
): Effect.Effect<ActivityLibrary, ActivityFailure> {
  return Effect.gen(function* () {
    const local = yield* decodeActivityLibrary(localInput);
    const remote = yield* decodeActivityLibrary(remoteInput);
    const activities = new Map(remote.activities.map((activity) => [activity.id, activity]));
    for (const activity of local.activities) {
      const previous = activities.get(activity.id);
      if (
        previous &&
        previous.revision === activity.revision &&
        stable(previous) !== stable(activity)
      )
        return yield* Effect.fail(
          failure(
            "conflict",
            `Activity “${activity.title}” was edited differently on another device. Export your local activities before loading the remote version.`,
          ),
        );
      if (!previous || activity.revision > previous.revision) activities.set(activity.id, activity);
    }
    const attempts = new Map(remote.attempts.map((attempt) => [attempt.id, attempt]));
    for (const attempt of local.attempts) {
      const previous = attempts.get(attempt.id);
      if (previous && stable(previous) !== stable(attempt))
        return yield* Effect.fail(
          failure("conflict", "Accepted attempt identities cannot be overwritten."),
        );
      attempts.set(attempt.id, attempt);
    }
    const drafts = new Map((remote.drafts ?? []).map((draft) => [draft.id, draft]));
    for (const draft of local.drafts ?? []) {
      if (attempts.has(draft.id)) continue;
      const previous = drafts.get(draft.id);
      if (previous && previous.updatedAt === draft.updatedAt && stable(previous) !== stable(draft))
        return yield* Effect.fail(
          failure(
            "conflict",
            "Attempt progress was changed differently on another device. Keep your local work before resolving the conflict.",
          ),
        );
      if (!previous || draft.updatedAt > previous.updatedAt) drafts.set(draft.id, draft);
    }
    for (const id of attempts.keys()) drafts.delete(id);
    const editorIsSaved = (draft: NonNullable<ActivityLibrary["editorDrafts"]>[number]) => {
      const saved = activities.get(draft.editing?.id ?? draft.id);
      return saved !== undefined && (!draft.editing || saved.revision > draft.editing.revision);
    };
    const editorDrafts = new Map(
      (remote.editorDrafts ?? [])
        .filter((draft) => !editorIsSaved(draft))
        .map((draft) => [draft.id, draft]),
    );
    for (const draft of local.editorDrafts ?? []) {
      if (editorIsSaved(draft)) continue;
      const previous = editorDrafts.get(draft.id);
      if (previous && previous.updatedAt === draft.updatedAt && stable(previous) !== stable(draft))
        return yield* Effect.fail(
          failure(
            "conflict",
            "An activity draft was changed differently on another device. Keep your local work before resolving the conflict.",
          ),
        );
      if (!previous || draft.updatedAt > previous.updatedAt) editorDrafts.set(draft.id, draft);
    }

    return yield* decodeActivityLibrary({
      version: 1,
      activities: [...activities.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
      attempts: [...attempts.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
      drafts: [...drafts.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
      editorDrafts: [...editorDrafts.values()].sort((a, b) => a.id.localeCompare(b.id, "en")),
    });
  });
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
