import { Effect, Schema } from "effect";
import {
  ActivityJsonSchema,
  type ActivityResponse,
  type ActivityRuntimeProvenance,
} from "@recall/domain";
import { failure } from "../learning-activities-plugins";
import {
  decodeLua,
  LuaDraftSchema,
  LuaEventSchema,
  decodeLuaView,
  LuaAssessmentSchema,
  type LuaDraft,
  type LuaEvent,
  type LuaPayload,
  type LuaRuntime,
} from "./contracts";

export function startLuaActivity(payload: LuaPayload, runtime: LuaRuntime) {
  const seed = payload.seed ?? 0;
  return runtime.invoke({ ...payload, seed, operation: "init" }).pipe(
    Effect.flatMap((state) => decodeLua(ActivityJsonSchema, state)),
    Effect.map((state): LuaDraft => ({
      version: 1,
      runtimeVersion: runtime.version,
      seed,
      state,
      events: [],
    })),
  );
}
export function viewLuaActivity(payload: LuaPayload, draft: LuaDraft, runtime: LuaRuntime) {
  return runtime
    .invoke({ ...payload, seed: draft.seed, operation: "view", state: draft.state })
    .pipe(Effect.flatMap((view) => decodeLuaView(view)));
}
export function updateLuaActivity(
  payload: LuaPayload,
  draft: LuaDraft,
  event: LuaEvent,
  runtime: LuaRuntime,
) {
  return Effect.gen(function* () {
    if (draft.events.length >= 100)
      return yield* Effect.fail(
        failure(
          "invalid-input",
          "This attempt reached its 100 interaction limit. Preserve the draft and start a new attempt.",
        ),
      );
    const validatedEvent = yield* decodeLua(LuaEventSchema, event);
    const view = yield* viewLuaActivity(payload, draft, runtime);
    if (!view.buttons.some((button) => button.id === validatedEvent.id))
      return yield* Effect.fail(
        failure("invalid-input", "Choose a currently available Lua action."),
      );
    const output = yield* runtime.invoke({
      ...payload,
      seed: draft.seed,
      operation: "update",
      state: draft.state,
      event: validatedEvent,
    });
    const state = yield* decodeLua(ActivityJsonSchema, output);
    return yield* decodeLua(LuaDraftSchema, {
      ...draft,
      state,
      events: [...draft.events, validatedEvent],
    });
  });
}
export function readLuaDraft(response: ActivityResponse) {
  return Schema.decodeUnknown(Schema.parseJson(LuaDraftSchema))(response.answers[0] ?? "").pipe(
    Effect.mapError(() =>
      failure("invalid-input", "Start the Lua workspace before submitting its completion."),
    ),
    Effect.flatMap((draft) => decodeLua(LuaDraftSchema, draft)),
  );
}
export function luaDraftResponse(response: ActivityResponse, draft: LuaDraft): ActivityResponse {
  return {
    ...response,
    answers: [JSON.stringify(draft)],
    selectedOptionIds: [],
    interaction: {
      ...response.interaction,
      seed: draft.seed,
      actions: draft.events.map((event) => ({
        type: "lua",
        targetId: event.id,
        ...(event.value === undefined ? {} : { value: event.value }),
      })),
    },
  };
}
/** Replay proposals instead of trusting imported/persisted state or scores. */
export function assessLuaActivity(
  payload: LuaPayload,
  response: ActivityResponse,
  runtime: LuaRuntime,
) {
  return Effect.gen(function* () {
    if (response.answers.length !== 1 || response.selectedOptionIds.length !== 0)
      return yield* Effect.fail(
        failure("invalid-input", "Submit one Lua completion draft without unrelated answers."),
      );
    const saved = yield* readLuaDraft(response);
    if (saved.runtimeVersion !== runtime.version || saved.seed !== (payload.seed ?? 0))
      return yield* Effect.fail(
        failure(
          "conflict",
          "The Lua runtime or seed changed. Start a new attempt; the original draft is preserved.",
        ),
      );
    let draft = yield* startLuaActivity(payload, runtime);
    for (const event of saved.events)
      draft = yield* updateLuaActivity(payload, draft, event, runtime);
    const raw = yield* runtime.invoke({
      ...payload,
      seed: draft.seed,
      operation: "assess",
      state: draft.state,
    });
    const assessment = yield* decodeLua(LuaAssessmentSchema, raw);
    if (!assessment.complete)
      return yield* Effect.fail(
        failure("invalid-input", "Complete the Lua activity before requesting assessment."),
      );
    return assessment;
  });
}

/** Acceptance composition may copy this metadata onto the immutable attempt. */
export function luaRuntimeProvenance(response: ActivityResponse) {
  return readLuaDraft(response).pipe(
    Effect.map((draft): ActivityRuntimeProvenance => ({
      runtime: "lua",
      runtimeVersion: draft.runtimeVersion,
      scriptVersion: "1",
      seed: draft.seed,
    })),
  );
}
