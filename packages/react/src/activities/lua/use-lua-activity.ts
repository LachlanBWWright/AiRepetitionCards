"use client";
import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import type { ActivityResponse, LearningActivity } from "@recall/domain";
import {
  decodeLuaPayload,
  luaDraftResponse,
  readLuaDraft,
  startLuaActivity,
  updateLuaActivity,
  viewLuaActivity,
  type ActivityFailure,
  type LuaDraft,
  type LuaEvent,
  type LuaRuntime,
  type LuaView,
} from "@recall/application";

export type LuaActivityWorkspaceProps = {
  readonly activity: LearningActivity;
  readonly response: ActivityResponse;
  readonly runtime: LuaRuntime;
  readonly onResponse: (response: ActivityResponse) => void;
  readonly disabled?: boolean | undefined;
};
export function useLuaActivity({
  activity,
  response,
  runtime,
  onResponse,
  disabled,
}: LuaActivityWorkspaceProps) {
  const [view, setView] = useState<LuaView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useRef<LuaDraft | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const identity = `${activity.id}:${String(activity.revision)}`;
  const [previous, setPrevious] = useState({ identity, runtime });
  if (previous.identity !== identity || previous.runtime !== runtime) {
    setPrevious({ identity, runtime });
    setView(null);
    setMessage(null);
    setBusy(false);
  }
  useEffect(() => {
    generation.current += 1;
    draft.current = null;
    pending.current = false;
  }, [identity, runtime]);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  async function run(
    operation: Effect.Effect<{ readonly draft: LuaDraft; readonly view: LuaView }, ActivityFailure>,
  ) {
    if (pending.current || disabled) return;
    pending.current = true;
    setBusy(true);
    const token = generation.current;
    const result = await Effect.runPromise(Effect.either(operation));
    if (token !== generation.current) return;
    pending.current = false;
    setBusy(false);
    if (Either.isLeft(result)) {
      setMessage(result.left.message);
      return;
    }
    draft.current = result.right.draft;
    setView(result.right.view);
    setMessage(null);
    onResponse(luaDraftResponse(response, result.right.draft));
  }
  function start() {
    void run(
      Effect.gen(function* () {
        const payload = yield* decodeLuaPayload(activity.payload);
        const next = response.answers[0]?.startsWith("{")
          ? yield* readLuaDraft(response)
          : yield* startLuaActivity(payload, runtime);
        if (next.runtimeVersion !== runtime.version || next.seed !== (payload.seed ?? 0))
          return yield* Effect.fail({
            _tag: "ActivityFailure" as const,
            reason: "conflict" as const,
            message:
              "The saved draft uses a different runtime or seed. Keep it for export and start a new attempt.",
          });
        return { draft: next, view: yield* viewLuaActivity(payload, next, runtime) };
      }),
    );
  }
  function dispatch(event: LuaEvent) {
    const current = draft.current;
    if (!current) return;
    void run(
      Effect.gen(function* () {
        const payload = yield* decodeLuaPayload(activity.payload);
        const next = yield* updateLuaActivity(payload, current, event, runtime);
        return { draft: next, view: yield* viewLuaActivity(payload, next, runtime) };
      }),
    );
  }
  return { view, message, busy, start, dispatch };
}
