import type { Dispatch, SetStateAction } from "react";
import { Effect } from "effect";
import type {
  ActivityLibrary,
  ActivityResponse,
  ActivityResult,
  LearningActivity,
  LearningAttempt,
} from "@recall/domain";
import {
  acceptLearningAttempt,
  assessLearningActivity,
  decodeActivityLibrary,
  findActivityPlugin,
  presentLearningActivity,
  reviseLearningActivity,
  type ActivityPresentation,
  type ActivityRegistry,
  type ActivityServices,
} from "@recall/application";
import { readRef } from "../read-ref";

type RefCell<Value> = { current: Value };
type Identity = {
  readonly id: string;
  readonly startedAt: string;
  readonly submittedAt?: string;
  readonly acceptedAt?: string;
};
type Run = <Value>(
  operation: Effect.Effect<Value, { readonly message: string }>,
  success: (value: Value) => Promise<void> | void,
  failureStatus?: (error: { readonly message: string }) => void,
) => Promise<void>;

export function useLearningActivitiesAttemptWorkflow({
  platform,
  library,
  registry,
  services,
  createId,
  run,
  persist,
  alive,
  attemptIdentity,
  draftFingerprint,
  activity,
  presentation,
  response,
  result,
  stage,
  suggestedQuestion,
  setActivity,
  setPresentation,
  setResponse,
  setResult,
  setStage,
  setReferenceShown,
  setSuggestedQuestion,
  setMessage,
  setSyncStatus,
}: {
  readonly platform: "web" | "native";
  readonly library: ActivityLibrary;
  readonly registry: ActivityRegistry;
  readonly services: ActivityServices | undefined;
  readonly createId: () => string;
  readonly run: Run;
  readonly persist: (next: ActivityLibrary, synchronized?: boolean) => Promise<boolean>;
  readonly alive: RefCell<boolean>;
  readonly attemptIdentity: RefCell<Identity | null>;
  readonly draftFingerprint: RefCell<string>;
  readonly activity: LearningActivity | null;
  readonly presentation: ActivityPresentation | null;
  readonly response: ActivityResponse;
  readonly result: ActivityResult | null;
  readonly stage: number;
  readonly suggestedQuestion: string | null;
  readonly setActivity: Dispatch<SetStateAction<LearningActivity | null>>;
  readonly setPresentation: Dispatch<SetStateAction<ActivityPresentation | null>>;
  readonly setResponse: Dispatch<SetStateAction<ActivityResponse>>;
  readonly setResult: Dispatch<SetStateAction<ActivityResult | null>>;
  readonly setStage: Dispatch<SetStateAction<number>>;
  readonly setReferenceShown: Dispatch<SetStateAction<boolean>>;
  readonly setSuggestedQuestion: Dispatch<SetStateAction<string | null>>;
  readonly setMessage: Dispatch<SetStateAction<string | null>>;
  readonly setSyncStatus: Dispatch<
    SetStateAction<"saved-locally" | "synchronized" | "awaiting-sync" | "conflicted">
  >;
}) {
  function supports(entry: LearningActivity) {
    return findActivityPlugin(registry, entry)?.capabilities.platforms.includes(platform) === true;
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

  function markSubmitted(value: ActivityResult) {
    setResult(value);
    const identity = attemptIdentity.current;
    if (identity) attemptIdentity.current = { ...identity, submittedAt: new Date().toISOString() };
  }

  function hostedAssess() {
    if (!activity || !services) return;
    void run(services.assess(activity, response), markSubmitted);
  }

  function followUp() {
    if (!activity || !services) return;
    void run(services.question(activity, response), (question) => {
      setSuggestedQuestion(question);
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
        if (await persist(next)) {
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

  function assess() {
    if (!activity) return;
    void run(assessLearningActivity(activity, response, registry), markSubmitted);
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
    start,
    resume,
    keep,
    hostedAssess,
    followUp,
    approveQuestion,
    archive,
    sync,
    assess,
    accept,
    answer,
    choose,
    leave,
    revise,
    reveal,
  };
}
