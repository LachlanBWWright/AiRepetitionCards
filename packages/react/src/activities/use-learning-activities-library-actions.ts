"use client";

import { Effect } from "effect";
import {
  reviseLearningActivity,
  type ActivityRegistry,
  type ActivityServices,
} from "@recall/application";
import type {
  ActivityLibrary,
  ActivityResponse,
  ActivityResult,
  LearningActivity,
} from "@recall/domain";
import type { Dispatch, SetStateAction } from "react";
import { readRef } from "../read-ref";

type Run = <A>(
  operation: Effect.Effect<A, { readonly message: string }>,
  success: (value: A) => Promise<void> | void,
  failureStatus?: (error: { readonly message: string }) => void,
) => Promise<void>;

type AttemptIdentity = {
  readonly id: string;
  readonly startedAt: string;
  readonly submittedAt?: string;
  readonly acceptedAt?: string;
};

export type LearningActivityLibraryActionDependencies = {
  readonly activity: LearningActivity | null;
  readonly response: ActivityResponse;
  readonly library: ActivityLibrary;
  readonly registry: ActivityRegistry;
  readonly services: ActivityServices | undefined;
  readonly alive: { current: boolean };
  readonly attemptIdentity: { current: AttemptIdentity | null };
  readonly run: Run;
  readonly persist: (next: ActivityLibrary, synchronized?: boolean) => Promise<boolean>;
  readonly setResult: Dispatch<SetStateAction<ActivityResult | null>>;
  readonly setSuggestedQuestion: Dispatch<SetStateAction<string | null>>;
  readonly setSyncStatus: Dispatch<
    SetStateAction<"saved-locally" | "synchronized" | "awaiting-sync" | "conflicted">
  >;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
};

export function useLearningActivitiesLibraryActions(
  dependencies: LearningActivityLibraryActionDependencies,
) {
  const {
    activity,
    response,
    library,
    registry,
    services,
    alive,
    attemptIdentity,
    run,
    persist,
    setResult,
    setSuggestedQuestion,
    setSyncStatus,
    setMessage,
  } = dependencies;

  function hostedAssess() {
    if (!activity || !services) return;
    void run(services.assess(activity, response), (value) => {
      setResult(value);
      const identity = attemptIdentity.current;
      if (identity)
        attemptIdentity.current = { ...identity, submittedAt: new Date().toISOString() };
    });
  }

  function followUp() {
    if (!activity || !services) return;
    void run(services.question(activity, response), (question) => {
      setSuggestedQuestion(question);
    });
  }

  function archive(entry: LearningActivity) {
    void run(
      reviseLearningActivity(
        library,
        { ...entry, archived: !entry.archived, revision: entry.revision + 1 },
        entry.revision,
        registry,
      ),
      async (next) => {
        if (await persist(next)) {
          if (alive.current)
            setMessage(
              entry.archived
                ? "Activity restored."
                : "Activity archived. Attempt history is preserved.",
            );
        } else if (alive.current) setMessage("Archive save not confirmed; retry.");
      },
    );
  }

  function sync() {
    if (!services) return;
    void run(
      services.sync(library),
      async (next) => {
        if (await persist(next, true)) {
          if (readRef(alive)) {
            setSyncStatus("synchronized");
            setMessage("Activities synchronized.");
          }
        } else if (alive.current) {
          setSyncStatus("conflicted");
          setMessage("Local save not confirmed. Retry synchronization.");
        }
      },
      (error) => {
        setSyncStatus(
          "reason" in error && error.reason === "conflict" ? "conflicted" : "awaiting-sync",
        );
      },
    );
  }

  function dismissQuestion() {
    setSuggestedQuestion(null);
  }

  return { hostedAssess, followUp, archive, sync, dismissQuestion };
}
