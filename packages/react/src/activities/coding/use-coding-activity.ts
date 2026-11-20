"use client";

import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import {
  codingPresentation,
  codingSubmissionResult,
  type ActivityServices,
} from "@recall/application";
import type {
  ActivityResponse,
  ActivityResult,
  CodingExecution,
  LearningActivity,
} from "@recall/domain";

export type CodingActivityOptions = {
  readonly activity: LearningActivity | null;
  readonly response: ActivityResponse;
  readonly services: ActivityServices | undefined;
  readonly disabled: boolean;
  readonly result: ActivityResult | null;
  readonly onSubmit: (result: ActivityResult) => void;
};

export function useCodingActivity(options: CodingActivityOptions) {
  const [execution, setExecution] = useState<CodingExecution | null>(null);
  const [executionMode, setExecutionMode] = useState<"run" | "submit" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guard = useRef(false);
  const generation = useRef(0);
  const activity = options.activity;
  const content = activity?.pluginId === "recall.coding" ? codingPresentation(activity) : null;
  useEffect(() => {
    generation.current += 1;
    const timer = setTimeout(() => {
      setExecution(null);
      setExecutionMode(null);
      setMessage(null);
      setBusy(false);
      guard.current = false;
    }, 0);
    return () => {
      generation.current += 1;
      clearTimeout(timer);
    };
  }, [activity?.id, activity?.revision]);

  async function execute(mode: "run" | "submit") {
    if (!activity || !content || options.disabled || options.result || guard.current) return;
    if (!options.services) {
      setMessage(
        "Execution is unavailable. Your code is retained; save progress or use the rubric below.",
      );
      return;
    }
    if (!options.response.answers[0]?.trim()) {
      setMessage("Enter a solve function before running or submitting.");
      return;
    }
    guard.current = true;
    setBusy(true);
    setMessage(null);
    const current = generation.current;
    const completed = await Effect.runPromise(
      Effect.either(options.services.execute(activity, options.response, mode)),
    );
    if (generation.current !== current) return;
    guard.current = false;
    setBusy(false);
    if (Either.isLeft(completed)) {
      setMessage(`${completed.left.message} Your code is retained.`);
      return;
    }
    setExecution(completed.right);
    setExecutionMode(mode);
    if (mode === "submit")
      options.onSubmit(codingSubmissionResult(activity, options.response, completed.right));
  }
  return {
    available: !!options.services && !!content,
    content,
    execution,
    executionMode,
    message,
    busy,
    run: () => {
      void execute("run");
    },
    submit: () => {
      void execute("submit");
    },
  };
}
