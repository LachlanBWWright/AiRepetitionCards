import { Effect, Schema } from "effect";
import { LearningAreaSchema, LearningObjectiveSchema, type LearningArea } from "@recall/domain";
import { authoredTagsValid, tagsUnchanged } from "./tag-input";

const InstructionSchema = Schema.String.pipe(Schema.maxLength(2000));
export const AreaSettingsSchema = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  language: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80)),
  tags: Schema.Array(Schema.String),
  licence: Schema.NullOr(Schema.String.pipe(Schema.maxLength(120))),
  attribution: Schema.NullOr(Schema.String.pipe(Schema.maxLength(500))),
  ai: Schema.Struct({
    tutorInstructions: InstructionSchema,
    quizInstructions: Schema.NullOr(InstructionSchema),
    cardGenerationInstructions: Schema.NullOr(InstructionSchema),
  }),
  objectives: Schema.Array(LearningObjectiveSchema).pipe(Schema.maxItems(200)),
});
export type AreaSettings = typeof AreaSettingsSchema.Type;
export type AreaSettingsFailure = {
  readonly _tag: "AreaSettingsInvalid";
  readonly message: string;
};
const invalid = (message: string): AreaSettingsFailure => ({
  _tag: "AreaSettingsInvalid",
  message,
});

/** Change area content without changing card identities, provenance or scheduling state. */
export const updateAreaSettings = (areaInput: unknown, settingsInput: unknown) =>
  Effect.gen(function* () {
    const area = yield* Schema.decodeUnknown(LearningAreaSchema)(areaInput).pipe(
      Effect.mapError(() => invalid("This knowledge area contains invalid data.")),
    );
    const settings = yield* Schema.decodeUnknown(AreaSettingsSchema)(settingsInput).pipe(
      Effect.mapError(() =>
        invalid(
          "Check the settings. Language and objective titles are required; AI instructions must be at most 2,000 characters.",
        ),
      ),
    );
    if (!tagsUnchanged(settings.tags, area.tags ?? []) && !authoredTagsValid(settings.tags))
      return yield* Effect.fail(
        invalid("Use up to 100 nonblank tags, each at most 80 characters long."),
      );
    if (!settings.language.trim()) {
      return yield* Effect.fail(invalid("Choose a language for this knowledge area."));
    }
    const ids = new Set(settings.objectives.map((objective) => objective.id));
    if (ids.size !== settings.objectives.length) {
      return yield* Effect.fail(invalid("Each objective must have a unique ID."));
    }
    const objectivesById = new Map(
      settings.objectives.map((objective) => [objective.id, objective]),
    );
    for (const objective of settings.objectives) {
      if (!objective.title.trim())
        return yield* Effect.fail(invalid("Give every objective a title."));
      if (new Set(objective.prerequisiteIds).size !== objective.prerequisiteIds.length) {
        return yield* Effect.fail(invalid("Choose each prerequisite only once."));
      }
      if (objective.prerequisiteIds.some((id) => !ids.has(id))) {
        return yield* Effect.fail(invalid("A prerequisite references a removed objective."));
      }
      const pending = [...objective.prerequisiteIds];
      const visited = new Set<string>();
      while (pending.length > 0) {
        const id = pending.pop();
        if (id === undefined || visited.has(id)) continue;
        if (id === objective.id)
          return yield* Effect.fail(invalid("Prerequisites cannot form a cycle."));
        visited.add(id);
        pending.push(...(objectivesById.get(id)?.prerequisiteIds ?? []));
      }
    }
    const cards = area.cards.map((card) => {
      const legacyLabel = card.objective.trim().toLocaleLowerCase("en");
      const previousObjectiveIds = new Set(
        (area.objectives ?? [])
          .filter((objective) => objective.title.trim().toLocaleLowerCase("en") === legacyLabel)
          .map((objective) => objective.id),
      );
      const objectiveIds = card.objectiveIds
        ? card.objectiveIds.filter((id) => ids.has(id))
        : settings.objectives
            .filter(
              (objective) =>
                previousObjectiveIds.has(objective.id) ||
                objective.title.trim().toLocaleLowerCase("en") === legacyLabel,
            )
            .map((objective) => objective.id);
      if (!card.objectiveIds && objectiveIds.length === 0) return card;
      const objective = objectiveIds
        .map((id) => objectivesById.get(id)?.title)
        .filter(Boolean)
        .join(" · ");
      return { ...card, objectiveIds, objective: objective || "Unassigned" };
    });
    const updated: LearningArea = { ...area, ...settings, cards };
    return yield* Schema.decodeUnknown(LearningAreaSchema)(updated).pipe(
      Effect.mapError(() => invalid("These settings could not be saved.")),
    );
  });
