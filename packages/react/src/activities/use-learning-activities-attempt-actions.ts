"use client";

import { Effect } from "effect";
import {
  acceptLearningAttempt,
  assessLearningActivity,
  decodeActivityLibrary,
  presentLearningActivity,
  findActivityPlugin,
  type ActivityPresentation,
  type ActivityRegistry,
} from "@recall/application";
import type {
  ActivityLibrary,
  ActivityResponse,
  ActivityResult,
  LearningActivity,
  LearningAttempt,
} from "@recall/domain";
import type { Dispatch, SetStateAction } from "react";
import { readRef } from "../read-ref";

type AttemptIdentity = {
  readonly id: string;
  readonly startedAt: string;
  readonly submittedAt?: string;
  readonly acceptedAt?: string;
};

type Run = <A>(
  operation: Effect.Effect<A, { readonly message: string }>,
  success: (value: A) => Promise<void> | void,
) => Promise<void>;

export type LearningActivityAttemptActionDependencies = {
  readonly library: ActivityLibrary;
  readonly registry: ActivityRegistry;
  readonly platform: "web" | "native";
  readonly activity: LearningActivity | null;
  readonly presentation: ActivityPresentation | null;
  readonly response: ActivityResponse;
  readonly result: ActivityResult | null;
  readonly stage: number;
  readonly suggestedQuestion: string | null;
  readonly attemptIdentity: { current: AttemptIdentity | null };
  readonly draftFingerprint: { current: string };
  readonly alive: { current: boolean };
  readonly createId: () => string;
  readonly persist: (next: ActivityLibrary, synchronized?: boolean) => Promise<boolean>;
  readonly run: Run;
  readonly setActivity: Dispatch<SetStateAction<LearningActivity | null>>;
  readonly setPresentation: Dispatch<SetStateAction<ActivityPresentation | null>>;
  readonly setResponse: Dispatch<SetStateAction<ActivityResponse>>;
  readonly setResult: Dispatch<SetStateAction<ActivityResult | null>>;
  readonly setStage: Dispatch<SetStateAction<number>>;
  readonly setSuggestedQuestion: Dispatch<SetStateAction<string | null>>;
  readonly setReferenceShown: Dispatch<SetStateAction<boolean>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
};

export function useLearningActivityAttemptActions(
  dependencies: LearningActivityAttemptActionDependencies,
) {
  const {
    library,
    registry,
    platform,
    activity,
    presentation,
    response,
    result,
    stage,
    suggestedQuestion,
    attemptIdentity,
    draftFingerprint,
    alive,
    createId,
    persist,
    run,
    setActivity,
    setPresentation,
    setResponse,
    setResult,
    setStage,
    setSuggestedQuestion,
    setReferenceShown,
    setMessage,
  } = dependencies;

  function supports(entry: LearningActivity) {
    return findActivityPlugin(registry, entry)?.capabilities.platforms.includes(platform) === true;
  }

  function openAttempt(entry: LearningActivity, content: ActivityPresentation) {
    draftFingerprint.current = "";
    setActivity(entry);
    setPresentation(content);
    setResult(null);
    setSuggestedQuestion(null);
    setReferenceShown(false);
    setStage(0);
    setResponse({
      presentedPrompts: content.prompts,
      answers: content.options.length ? [] : content.prompts.map(() => ""),
      selectedOptionIds: [],
      selfScore: 0.5,
      assistance: "none",
    });
    attemptIdentity.current = { id: createId(), startedAt: new Date().toISOString() };
  }

  function start(entry: LearningActivity) {
    if (!supports(entry)) {
      setMessage("This plugin is unavailable on this platform. Content and history are preserved.");
      return;
    }
    void run(presentLearningActivity(entry, registry), (content) => {
      openAttempt(entry, content);
    });
  }

  function resume(id: string) {
    const draft = library.drafts?.find((entry) => entry.id === id);
    if (!draft || !supports(draft.activity)) return;
    void run(presentLearningActivity(draft.activity, registry), (content) => {
      draftFingerprint.current = "";
      setActivity(draft.activity);
      setPresentation({ ...content, prompts: draft.response.presentedPrompts ?? content.prompts });
      setResponse(draft.response);
      setStage(draft.stage);
      setReferenceShown(draft.response.assistance === "answer-revealed");
      setResult(null);
      setSuggestedQuestion(null);
      attemptIdentity.current = { id: draft.id, startedAt: draft.startedAt };
    });
  }

  function leave() {
    setActivity(null);
    setPresentation(null);
    setResult(null);
    setMessage(null);
  }

  function keep() {
    const identity = attemptIdentity.current;
    if (!activity || !identity || result) return;
    const draft = {
      id: identity.id,
      activity,
      response,
      stage,
      startedAt: identity.startedAt,
      updatedAt: new Date().toISOString(),
    };
    void run(
      decodeActivityLibrary({
        ...library,
        drafts: [...(library.drafts ?? []).filter((entry) => entry.id !== draft.id), draft],
      }),
      async (next) => {
        if (await persist(next)) {
          if (readRef(alive)) {
            leave();
            setMessage("Progress saved. Resume this attempt later.");
          }
        } else if (alive.current)
          setMessage("Progress save not confirmed. Your attempt is still open; retry.");
      },
    );
  }

  function assess() {
    if (!activity) return;
    void run(assessLearningActivity(activity, response, registry), (value) => {
      setResult(value);
      const identity = attemptIdentity.current;
      if (identity)
        attemptIdentity.current = { ...identity, submittedAt: new Date().toISOString() };
    });
  }

  function accept() {
    const identity = attemptIdentity.current;
    if (!activity || !result || !identity?.submittedAt) return;
    const acceptedAt = identity.acceptedAt ?? new Date().toISOString();
    attemptIdentity.current = { ...identity, acceptedAt };
    const attempt: LearningAttempt = {
      id: identity.id,
      activity,
      response,
      result,
      startedAt: identity.startedAt,
      submittedAt: identity.submittedAt,
      acceptedAt,
    };
    void run(acceptLearningAttempt(library, attempt, registry), async (next) => {
      const saved = await persist(next);
      if (!alive.current) return;
      if (saved) {
        setActivity(null);
        setPresentation(null);
        setResult(null);
        setMessage("Attempt recorded. Review schedules are unchanged.");
      } else
        setMessage(
          "Save not confirmed. Your result is retained; retry recording it before leaving.",
        );
    });
  }

  function approveQuestion() {
    if (!suggestedQuestion || !presentation || result || presentation.prompts.length >= 10) return;
    const prompts = [...presentation.prompts, suggestedQuestion];
    setPresentation({ ...presentation, prompts });
    setResponse((current) => ({
      ...current,
      presentedPrompts: prompts,
      answers: [...current.answers, ""],
    }));
    setStage(prompts.length - 1);
    setSuggestedQuestion(null);
  }

  function answer(index: number, value: string) {
    setResponse((current) => ({
      ...current,
      answers: current.answers.map((entry, position) => (position === index ? value : entry)),
    }));
  }

  function choose(id: string) {
    setResponse((current) => ({
      ...current,
      selectedOptionIds: current.selectedOptionIds.includes(id)
        ? current.selectedOptionIds.filter((entry) => entry !== id)
        : [...current.selectedOptionIds, id],
    }));
  }

  function revise() {
    setResult(null);
    setResponse((current) => ({ ...current, assistance: "answer-revealed" }));
    const previous = attemptIdentity.current;
    attemptIdentity.current = {
      id:
        previous && !library.attempts.some((attempt) => attempt.id === previous.id)
          ? previous.id
          : createId(),
      startedAt: previous?.startedAt ?? new Date().toISOString(),
    };
  }

  function reveal() {
    setReferenceShown(true);
    setResponse((current) => ({ ...current, assistance: "answer-revealed" }));
  }

  return {
    openAttempt,
    start,
    resume,
    keep,
    assess,
    accept,
    approveQuestion,
    answer,
    choose,
    revise,
    leave,
    reveal,
  };
}
