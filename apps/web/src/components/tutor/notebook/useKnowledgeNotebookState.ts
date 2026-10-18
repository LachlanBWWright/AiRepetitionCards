import type { ReviewEvent } from "@recall/domain";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Effect, Either } from "effect";
import {
  findCardDuplicates,
  knowledgeAreaDuplicateCandidates,
  proposalDuplicateCandidates,
  appendNotebookReviewEvidence,
  createKnowledgeNotebookTutor,
  deriveNotebookAssessments,
  type KnowledgeNotebook,
  type NotebookProposal,
  type WorkspaceSearchTarget,
} from "@recall/application";
import { cardIdForTutorProposal, type CardProposal } from "@recall/ai-core";
import {
  createBrowserKnowledgeNotebookStore,
  createSessionKnowledgeNotebookStore,
} from "@/lib/knowledge-notebook-store";
import { tutorApi } from "@/lib/tutor-api";
import { focusSearchTarget } from "../../search/search-focus";
import type { NotebookNoticeFailure as NoticeFailure } from "./KnowledgeNotebookPanel.types";

const noReviews: readonly ReviewEvent[] = [];
export function useKnowledgeNotebookState({
  knowledgeArea,
  sessionOnly = false,
  duplicateCandidates = knowledgeAreaDuplicateCandidates(knowledgeArea),
  api = tutorApi,
  sessionNamespace = "hosted",
  reviewEvents = noReviews,
  initialNotebook,
  initialGoal,
  initialActivity = "practice",
  quickQuestions,
  research,
  additionalSuggestions,
  practiceTopics,
  onPracticeTopic,
  quickQuestionsBusy = false,
  showActivityNavigation = true,
  searchTarget,
  demo = false,
  onApprove,
  onStartReview,
  clock = Date.now,
}: import("./KnowledgeNotebookPanel.types").KnowledgeNotebookPanelProps) {
  const store = useMemo(
    () =>
      sessionOnly
        ? createSessionKnowledgeNotebookStore()
        : createBrowserKnowledgeNotebookStore(sessionNamespace, knowledgeArea.id),
    [sessionNamespace, knowledgeArea.id, sessionOnly],
  );
  const [notebook, setNotebook] = useState<KnowledgeNotebook | null>(initialNotebook ?? null);
  const current = useRef<KnowledgeNotebook | null>(initialNotebook ?? null);
  const alive = useRef(0);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<"practice" | "quick" | "materials" | "suggestions">(
    initialActivity,
  );
  const hasQuickQuestions = quickQuestions !== undefined;
  const searchRoot = useRef<HTMLElement | null>(null);
  const focusedSearchTarget = useRef<WorkspaceSearchTarget | null>(null);
  useEffect(() => {
    if (
      hasQuickQuestions &&
      searchTarget &&
      "namespace" in searchTarget &&
      searchTarget.namespace === `${sessionNamespace}:card-refinements`
    ) {
      const frame = window.requestAnimationFrame(() => {
        setActivity("suggestions");
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }
    if (
      !searchTarget ||
      !("namespace" in searchTarget) ||
      searchTarget.namespace !== sessionNamespace
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      setActivity(
        searchTarget.kind === "suggestion"
          ? "suggestions"
          : ["material", "passage", "claim"].includes(searchTarget.kind)
            ? "materials"
            : "practice",
      );
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [searchTarget, sessionNamespace, hasQuickQuestions]);
  useEffect(() => {
    if (
      !searchTarget ||
      !("namespace" in searchTarget) ||
      searchTarget.namespace !== sessionNamespace
    )
      return;
    const next =
      searchTarget.kind === "suggestion"
        ? "suggestions"
        : ["material", "passage", "claim"].includes(searchTarget.kind)
          ? "materials"
          : "practice";
    if (activity !== next) return;
    const frame = window.requestAnimationFrame(() => {
      if (
        focusedSearchTarget.current !== searchTarget &&
        searchRoot.current &&
        focusSearchTarget(searchRoot.current, searchTarget)
      )
        focusedSearchTarget.current = searchTarget;
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [searchTarget, sessionNamespace, notebook, activity]);
  const [loaded, setLoaded] = useState(demo);
  const [unsaved, setUnsaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const goalId = useId();
  const goalHelpId = `${goalId}-help`;
  const [goal, setGoal] = useState(
    initialNotebook?.goal ??
      initialGoal ??
      `Understand ${knowledgeArea.title} and identify gaps in its cards`,
  );
  const [answer, setAnswer] = useState(initialNotebook?.session.draftAnswer ?? "");
  const [confidence, setConfidence] = useState<"guess" | "unsure" | "confident">(
    initialNotebook?.session.draftConfidence ?? "unsure",
  );
  const [conceptTitle, setConceptTitle] = useState("");
  const [parentId, setParentId] = useState("");
  const [clearConfirm, setClearConfirm] = useState(false);
  const [drafts, setDrafts] = useState<Readonly<Record<string, CardProposal>>>({});
  const [duplicateAcknowledgements, setDuplicateAcknowledgements] = useState<
    Readonly<Record<string, string>>
  >({});
  function proposalDuplicates(entry: NotebookProposal, draft: CardProposal) {
    const candidates = [
      ...duplicateCandidates,
      ...proposalDuplicateCandidates(
        (notebook?.proposals ?? [])
          .filter((item) => item.id !== entry.id && item.status === "pending")
          .map((item) => ({
            id: `proposal:${item.id}`,
            proposal: drafts[item.id] ?? item.proposal,
          })),
      ),
    ];
    const ownCardId = cardIdForTutorProposal(entry.id);
    const matches = findCardDuplicates(
      draft,
      candidates,
      ownCardId ? { excludeCardId: ownCardId } : {},
    );
    const key = JSON.stringify([draft.front, draft.back, matches.map((match) => match.candidate)]);
    return { matches, key, acknowledged: duplicateAcknowledgements[entry.id] === key };
  }
  const publish = useCallback((next: KnowledgeNotebook | null) => {
    if (
      current.current?.session.pendingQuestion !== next?.session.pendingQuestion ||
      current.current?.session.draftAnswer !== next?.session.draftAnswer ||
      current.current?.session.draftConfidence !== next?.session.draftConfidence
    ) {
      setAnswer(next?.session.draftAnswer ?? "");
      setConfidence(next?.session.draftConfidence ?? "unsure");
    }
    current.current = next;
    setNotebook(next);
  }, []);
  const save = useCallback(
    (
      next: KnowledgeNotebook,
      epoch = alive.current,
    ): Effect.Effect<KnowledgeNotebook, NoticeFailure> => {
      return Effect.gen(function* () {
        if (epoch !== alive.current)
          return yield* Effect.fail({
            message: "This investigation view changed. Reopen its saved notebook to continue.",
          });
        publish(next);
        setUnsaved(!demo);
        if (!demo) yield* store.write(next);
        if (epoch !== alive.current)
          return yield* Effect.fail({
            message: "This investigation view changed. Its saved notebook remains available.",
          });
        setUnsaved(false);
        return next;
      });
    },
    [demo, store, publish],
  );
  function currentTutor() {
    const epoch = alive.current;
    return createKnowledgeNotebookTutor(api, (next) => save(next, epoch).pipe(Effect.asVoid));
  }
  const run = useCallback(
    <E extends NoticeFailure>(
      operation: Effect.Effect<KnowledgeNotebook, E>,
      success?: () => void,
      failure?: () => void,
    ) => {
      if (!loaded || working.current) return;
      working.current = true;
      setBusy(true);
      setMessage(null);
      const epoch = alive.current;
      void Effect.runPromise(Effect.either(operation)).then((result) => {
        if (epoch !== alive.current) return;
        if (Either.isLeft(result)) {
          if (result.left.notebook) publish(result.left.notebook);
          setMessage(result.left.message);
          failure?.();
        } else {
          publish(result.right);
          success?.();
        }
        working.current = false;
        setBusy(false);
      });
    },
    [loaded, publish],
  );
  useEffect(() => {
    const epoch = ++alive.current;
    if (!demo) {
      void Effect.runPromise(Effect.either(store.read())).then((result) => {
        if (epoch !== alive.current) return;
        if (Either.isLeft(result)) setMessage(result.left.message);
        else {
          publish(result.right);
          setGoal(result.right?.goal ?? "");
          setLoaded(true);
        }
      });
    }
    return () => {
      alive.current += 1;
    };
  }, [store, demo, publish]);
  useEffect(() => {
    if (!loaded || busy || !current.current || reviewEvents.length === 0) return;
    const existing = current.current;
    const epoch = alive.current;
    void Effect.runPromise(
      Effect.either(appendNotebookReviewEvidence(existing, knowledgeArea, reviewEvents)),
    ).then((enriched) => {
      if (epoch !== alive.current || current.current !== existing) return;
      if (Either.isLeft(enriched)) {
        setMessage(enriched.left.message);
        return;
      }
      if (JSON.stringify(enriched.right.evidence) !== JSON.stringify(existing.evidence))
        run(save(enriched.right, epoch));
    });
  }, [loaded, busy, reviewEvents, knowledgeArea, run, save]);
  const assessmentResult = notebook
    ? Effect.runSync(Effect.either(deriveNotebookAssessments(notebook)))
    : null;
  const assessments =
    assessmentResult && Either.isRight(assessmentResult) ? assessmentResult.right : [];
  const active = notebook?.session.phase === "active";
  const goalChanged = notebook !== null && goal.trim() !== notebook.goal;
  const pendingQuestion = notebook?.session.pendingQuestion;
  const lastEvidence = notebook
    ? [...notebook.evidence].reverse().find((entry) => entry.kind === "tutor")
    : undefined;
  const pendingProposals = notebook?.proposals.filter((entry) => entry.status === "pending") ?? [];
  const accepted = notebook?.proposals.filter((entry) => entry.status === "accepted") ?? [];
  const networkDisabled = busy || !loaded || unsaved;
  const questionDisabled = networkDisabled || goalChanged;
  const context = { knowledgeArea, history: [] };
  return {
    knowledgeArea,
    duplicateCandidates,
    api,
    sessionNamespace,
    reviewEvents,
    initialNotebook,
    initialGoal,
    initialActivity,
    quickQuestions,
    research,
    additionalSuggestions,
    practiceTopics,
    onPracticeTopic,
    quickQuestionsBusy,
    showActivityNavigation,
    searchTarget,
    demo,
    onApprove,
    onStartReview,
    clock,
    store,
    notebook,
    setNotebook,
    current,
    alive,
    working,
    busy,
    setBusy,
    activity,
    setActivity,
    hasQuickQuestions,
    searchRoot,
    focusedSearchTarget,
    loaded,
    setLoaded,
    unsaved,
    setUnsaved,
    message,
    setMessage,
    goalId,
    goalHelpId,
    goal,
    setGoal,
    answer,
    setAnswer,
    confidence,
    setConfidence,
    conceptTitle,
    setConceptTitle,
    parentId,
    setParentId,
    clearConfirm,
    setClearConfirm,
    drafts,
    setDrafts,
    duplicateAcknowledgements,
    setDuplicateAcknowledgements,
    proposalDuplicates,
    publish,
    save,
    currentTutor,
    run,
    assessmentResult,
    assessments,
    active,
    goalChanged,
    pendingQuestion,
    lastEvidence,
    pendingProposals,
    accepted,
    networkDisabled,
    questionDisabled,
    context,
  } as const;
}
export type KnowledgeNotebookState = ReturnType<typeof useKnowledgeNotebookState>;
