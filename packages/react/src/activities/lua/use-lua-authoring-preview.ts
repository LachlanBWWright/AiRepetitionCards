"use client";
import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import type { ActivityResponse, LearningActivity } from "@recall/domain";
import {
  buildLuaAuthoringPayload,
  luaAuthoringFields,
  type LuaAuthoringValues,
} from "@recall/application";

const emptyResponse: ActivityResponse = {
  answers: [],
  selectedOptionIds: [],
  selfScore: 0.5,
  assistance: "none",
};
export function useLuaAuthoringPreview(fields: LuaAuthoringValues, template: LearningActivity) {
  const [preview, setPreview] = useState<LearningActivity | null>(null);
  const [response, setResponse] = useState(emptyResponse);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const token = useRef(0);
  const fingerprint = JSON.stringify(fields);
  const [previous, setPrevious] = useState(fingerprint);
  if (previous !== fingerprint) {
    setPrevious(fingerprint);
    setPreview(null);
    setBusy(false);
  }
  useEffect(() => {
    token.current += 1;
  }, [fingerprint]);
  useEffect(
    () => () => {
      token.current += 1;
    },
    [],
  );
  async function prepare() {
    const generation = ++token.current;
    setBusy(true);
    const result = await Effect.runPromise(Effect.either(buildLuaAuthoringPayload(fields)));
    if (token.current !== generation) return;
    setBusy(false);
    if (Either.isLeft(result)) {
      setMessage(result.left.message);
      return;
    }
    setMessage("Preview only. Save and approve the authored activity separately.");
    setResponse(emptyResponse);
    setPreview({
      ...template,
      pluginId: "recall.lua",
      pluginVersion: 1,
      fallback: fields.fallback ?? luaAuthoringFields[3].initial,
      payload: {
        script: result.right.script,
        configuration: result.right.configuration,
        ...(result.right.seed === undefined ? {} : { seed: result.right.seed }),
      },
    });
  }
  return { preview, response, setResponse, message, busy, prepare };
}
