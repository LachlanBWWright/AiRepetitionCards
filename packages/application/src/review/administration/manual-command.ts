import { Effect, Schema } from "effect";
import { normalizeManualDue } from "./manual-time";
import { ManualSchedulingCommandSchema } from "./manual-scheduling";
const Draft = Schema.Struct({
  ...ManualSchedulingCommandSchema.fields,
  position: Schema.optional(Schema.String),
});
export function prepareManualSchedulingCommand(input: unknown) {
  const invalid = {
    message: "Choose matching cards and a valid scheduling action, due date, or position.",
  };
  return Schema.decodeUnknown(Draft)(input).pipe(
    Effect.mapError(() => invalid),
    Effect.flatMap((draft) => {
      if (draft.action === "reposition" && !draft.position?.trim()) return Effect.fail(invalid);
      const due = draft.action === "due" ? normalizeManualDue(draft.due) : undefined;
      if (draft.action === "due" && !due)
        return Effect.fail({ message: "Choose a valid due date with an explicit time zone." });
      return Schema.decodeUnknown(ManualSchedulingCommandSchema)({
        ...draft,
        ...(due ? { due } : {}),
        position:
          draft.action === "reposition" && draft.position?.trim()
            ? Number(draft.position)
            : undefined,
      }).pipe(Effect.mapError(() => invalid));
    }),
  );
}
