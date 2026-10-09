"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Button, Input, Textarea } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { NativeSelect } from "@recall/ui-web/components/native-select";
import { Tabs, TabsList, TabsTrigger } from "@recall/ui-web/components/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Effect, Either, Schema } from "effect";
import {
  findCardDuplicates,
  knowledgeAreaDuplicateCandidates,
  proposalDuplicateCandidates,
  type CardDuplicateCandidate,
  addNotebookConcepts,
  applyNotebookRefinement,
  appendNotebookReviewEvidence,
  beginNotebookSession,
  controlNotebookSession,
  createKnowledgeNotebookTutor,
  deriveNotebookAssessments,
  editNotebookProposal,
  KnowledgeNotebookSchema,
  markNotebookProposalAcknowledged,
  resolveNotebookProposal,
  seedKnowledgeNotebook,
  updateNotebookAnswerDraft,
  type KnowledgeNotebook,
  type NotebookProposal,
  type WorkspaceSearchTarget,
} from "@recall/application";
import { CardProposalSchema, cardIdForTutorProposal, type CardProposal } from "@recall/ai-core";
import {
  createAssessmentId,
  createObjectiveId,
  type KnowledgeArea,
  type ReviewEvent,
} from "@recall/domain";
import { createBrowserKnowledgeNotebookStore } from "@/lib/knowledge-notebook-store";
import { tutorApi } from "@/lib/tutor-api";
import { ProposalDuplicateWarning } from "./ProposalDuplicateWarning";
import { CardAssistancePanel } from "./CardAssistancePanel";
import { StudyMaterialsPanel } from "./StudyMaterialsPanel";
import { focusSearchTarget } from "../search/search-focus";

export type KnowledgeNotebookPanelProps = {
  readonly knowledgeArea: KnowledgeArea;
  readonly duplicateCandidates?: readonly CardDuplicateCandidate[];
  readonly api?: typeof tutorApi;
  readonly sessionNamespace?: string;
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly initialNotebook?: KnowledgeNotebook;
  readonly searchTarget?: WorkspaceSearchTarget;
  readonly initialActivity?: "practice" | "materials" | "suggestions";
  readonly demo?: boolean;
  readonly onApprove: (
    proposal: CardProposal,
    cardId: string,
    proposalId: string,
    sessionId: string,
  ) => Promise<CardProposal | null>;
  readonly onStartReview?: () => void;
  readonly clock?: () => number;
};
type NoticeFailure = { readonly message: string; readonly notebook?: KnowledgeNotebook | null };
const noReviews: readonly ReviewEvent[] = [];

export function KnowledgeNotebookPanel({
  knowledgeArea,
  duplicateCandidates = knowledgeAreaDuplicateCandidates(knowledgeArea),
  api = tutorApi,
  sessionNamespace = "hosted",
  reviewEvents = noReviews,
  initialNotebook,
  initialActivity = "practice",
  searchTarget,
  demo = false,
  onApprove,
  onStartReview,
  clock = Date.now,
}: KnowledgeNotebookPanelProps) {
  const store = useMemo(
    () => createBrowserKnowledgeNotebookStore(sessionNamespace, knowledgeArea.id),
    [sessionNamespace, knowledgeArea.id],
  );
  const [notebook, setNotebook] = useState<KnowledgeNotebook | null>(initialNotebook ?? null);
  const current = useRef<KnowledgeNotebook | null>(initialNotebook ?? null);
  const alive = useRef(0);
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<"practice" | "materials" | "suggestions">(
    initialActivity,
  );
  const searchRoot = useRef<HTMLElement | null>(null);
  const focusedSearchTarget = useRef<WorkspaceSearchTarget | null>(null);
  useEffect(() => {
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
    return () => window.cancelAnimationFrame(frame);
  }, [searchTarget, sessionNamespace]);
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
    return () => window.cancelAnimationFrame(frame);
  }, [searchTarget, sessionNamespace, notebook, activity]);
  const [loaded, setLoaded] = useState(demo);
  const [unsaved, setUnsaved] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [goal, setGoal] = useState(initialNotebook?.goal ?? "");
  const [answer, setAnswer] = useState(initialNotebook?.session.draftAnswer ?? "");
  const [confidence, setConfidence] = useState<"guess" | "unsure" | "confident">(
    initialNotebook?.session.draftConfidence ?? "unsure",
  );
  const [questionLimit, setQuestionLimit] = useState(
    String(initialNotebook?.session.maxQuestions ?? 30),
  );
  const [requestLimit, setRequestLimit] = useState(
    String(initialNotebook?.session.maxRequests ?? 100),
  );
  const [minutes, setMinutes] = useState(
    String((initialNotebook?.session.maximumDurationMs ?? 1_800_000) / 60_000),
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
  const [now, setNow] = useState(clock);
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
        } else {
          publish(result.right);
          success?.();
        }
        working.current = false;
        setBusy(false);
        setNow(clock());
      });
    },
    [loaded, clock, publish],
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
    const timer = window.setInterval(() => setNow(clock()), 15_000);
    return () => window.clearInterval(timer);
  }, [clock]);
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
  const pendingQuestion = notebook?.session.pendingQuestion;
  const lastEvidence = notebook
    ? [...notebook.evidence].reverse().find((entry) => entry.kind === "tutor")
    : undefined;
  const pendingProposals = notebook?.proposals.filter((entry) => entry.status === "pending") ?? [];
  const accepted = notebook?.proposals.filter((entry) => entry.status === "accepted") ?? [];
  const elapsed =
    notebook?.session.startedAt == null ? 0 : Math.max(0, now - notebook.session.startedAt);
  const expired = active && notebook !== null && elapsed >= notebook.session.maximumDurationMs;
  const exhausted =
    notebook !== null && notebook.session.requestsUsed >= notebook.session.maxRequests;
  const networkDisabled = busy || !loaded || unsaved || exhausted;
  const questionDisabled =
    networkDisabled ||
    expired ||
    (notebook !== null && notebook.session.askedQuestions >= notebook.session.maxQuestions);
  const context = { knowledgeArea, history: [] };

  function begin() {
    const existing = current.current;
    run(
      Effect.gen(function* () {
        const seeded = existing ?? (yield* seedKnowledgeNotebook(knowledgeArea, goal.trim()));
        const enriched = yield* appendNotebookReviewEvidence(seeded, knowledgeArea, reviewEvents);
        const started = yield* beginNotebookSession(enriched, {
          startedAt: clock(),
          maxQuestions: Number(questionLimit),
          maxRequests: Number(requestLimit),
          maximumDurationMs: Number(minutes) * 60_000,
        });
        return yield* save(started);
      }),
    );
  }
  function ask() {
    const existing = current.current;
    if (existing) run(currentTutor().ask(existing, context, clock()).pipe(Effect.flatMap(save)));
  }
  function submitAnswer(value: string, learnerConfidence = confidence) {
    const existing = current.current;
    if (!existing) return;
    const submitted = value;
    const ai = currentTutor();
    run(
      updateNotebookAnswerDraft(existing, { answer: submitted, learnerConfidence }).pipe(
        Effect.flatMap(save),
        Effect.flatMap((saved) =>
          ai.answer(
            saved,
            { answer: submitted, learnerConfidence, evidenceId: crypto.randomUUID() },
            clock(),
          ),
        ),
        Effect.flatMap(save),
      ),
      () => setAnswer((latest) => (latest === submitted ? "" : latest)),
    );
  }
  function control(action: "deeper" | "explain" | "skip" | "finish") {
    const existing = current.current;
    if (!existing) return;
    const ai = currentTutor();
    run(
      controlNotebookSession(existing, { action, now: clock() }).pipe(
        Effect.flatMap(save),
        Effect.flatMap((next) =>
          action === "explain"
            ? ai.ask(next, context, clock()).pipe(Effect.flatMap(save))
            : Effect.succeed(next),
        ),
      ),
    );
  }
  function addConcept() {
    const existing = current.current;
    if (!existing) return;
    run(
      addNotebookConcepts(existing, [
        {
          id: createObjectiveId(crypto.randomUUID()),
          title: conceptTitle.trim(),
          description: null,
          parentId: parentId ? createObjectiveId(parentId) : null,
          prerequisiteIds: [],
          objectiveId: null,
        },
      ]).pipe(Effect.flatMap(save)),
      () => setConceptTitle(""),
    );
  }
  function acceptSuggestedConcept(title: string, description: string) {
    const existing = current.current;
    if (!existing) return;
    run(
      addNotebookConcepts(existing, [
        {
          id: createObjectiveId(crypto.randomUUID()),
          title,
          description,
          parentId: existing.session.targetConceptId,
          prerequisiteIds: [],
          objectiveId: null,
        },
      ]).pipe(Effect.flatMap(save)),
    );
  }
  function proposeGaps() {
    const ai = currentTutor();
    const existing = current.current;
    if (!existing) return;
    const targets = assessments.filter(
      (entry) => entry.status === "needs-reinforcement" || entry.status === "uncertain",
    );
    run(
      Effect.gen(function* () {
        let next = existing;
        for (const target of targets) {
          const evidence = [...next.evidence]
            .reverse()
            .find(
              (entry) =>
                entry.kind === "tutor" &&
                entry.conceptId === target.conceptId &&
                entry.providerSessionId &&
                entry.evaluation.suggestedAction === "propose-card",
            );
          if (
            !evidence ||
            next.proposals.some(
              (proposal) =>
                proposal.status !== "discarded" && proposal.evidenceIds.includes(evidence.id),
            )
          )
            continue;
          next = yield* ai.propose(next, evidence.id, knowledgeArea.cards, clock());
          next = yield* save(next);
        }
        return next;
      }),
    );
  }
  function editProposal(id: string, draft: CardProposal) {
    setDrafts((existing) => ({ ...existing, [id]: draft }));
  }
  function saveProposalEdits(entry: NotebookProposal) {
    const existing = current.current;
    if (!existing) return;
    run(
      editNotebookProposal(
        existing,
        { id: entry.id, proposal: drafts[entry.id] ?? entry.proposal },
        knowledgeArea.cards,
      ).pipe(Effect.flatMap(save)),
      () =>
        setDrafts((previous) => {
          const next = { ...previous };
          delete next[entry.id];
          return next;
        }),
    );
  }
  function reloadNotebook() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const epoch = alive.current;
    void Effect.runPromise(Effect.either(store.read())).then((result) => {
      if (epoch !== alive.current) return;
      if (Either.isLeft(result)) setMessage(result.left.message);
      else {
        publish(result.right);
        setGoal(result.right?.goal ?? "");
        setDrafts({});
        setUnsaved(false);
        setLoaded(true);
        setMessage(null);
      }
      working.current = false;
      setBusy(false);
    });
  }
  function resolve(entry: NotebookProposal, decision: "accepted" | "discarded") {
    const existing = current.current;
    if (!existing) return;
    const epoch = alive.current;
    run(
      Effect.gen(function* () {
        if (decision === "discarded") {
          const discarded = yield* resolveNotebookProposal(existing, {
            id: entry.id,
            status: "discarded",
          });
          yield* save(discarded, epoch);
          if (!demo && entry.providerResolutionRequired !== false)
            yield* api.resolveProposal({ proposalId: entry.id, state: "rejected" }).pipe(
              Effect.mapError(() => ({
                message:
                  "The proposal is discarded locally. Retry confirmation when your tutor connection is available.",
              })),
            );
          const acknowledged = yield* markNotebookProposalAcknowledged(discarded, entry.id);
          return yield* save(acknowledged, epoch);
        }
        const draft = yield* Schema.decodeUnknown(CardProposalSchema)(
          drafts[entry.id] ?? entry.proposal,
        ).pipe(
          Effect.mapError(() => ({
            message:
              "Complete the question, answer and rationale within the field limits before approval.",
          })),
        );
        const duplicates = proposalDuplicates(entry, draft);
        if (entry.status === "pending" && duplicates.matches.length > 0 && !duplicates.acknowledged)
          return yield* Effect.fail({
            message: "Review the possible duplicates and choose Keep both before saving.",
          });
        const cardId = cardIdForTutorProposal(entry.id);
        const providerSessionId = entry.providerSessionId;
        if (!cardId || !providerSessionId)
          return yield* Effect.fail({
            message:
              "This proposal has no valid tutor session. Keep your notebook and generate a new proposal from its evidence.",
          });
        if (epoch !== alive.current)
          return yield* Effect.fail({
            message:
              "This investigation view changed. Reopen the saved notebook before approving cards.",
          });
        const prepared =
          entry.status === "pending"
            ? yield* editNotebookProposal(
                existing,
                { id: entry.id, proposal: draft },
                knowledgeArea.cards,
              ).pipe(Effect.flatMap((next) => save(next, epoch)))
            : existing;
        const canonical =
          entry.status === "accepted"
            ? entry.proposal
            : yield* Effect.tryPromise({
                try: () => onApprove(draft, cardId, entry.id, providerSessionId),
                catch: () => ({
                  message: "The card could not be saved. Your proposal remains available.",
                }),
              });
        if (!canonical)
          return yield* Effect.fail({
            message: "The card was not saved. Your proposal and edits remain available to retry.",
          });
        let next = yield* resolveNotebookProposal(prepared, {
          id: entry.id,
          status: "accepted",
          cardId: createAssessmentId(cardId),
          proposal: canonical,
        });
        next = yield* save(next, epoch);
        if (!demo && entry.providerResolutionRequired !== false)
          yield* api
            .resolveProposal({
              proposalId: entry.id,
              state: "approved",
              cardId,
              content: canonical,
            })
            .pipe(
              Effect.mapError(() => ({
                message:
                  "Your card is saved. Retry confirmation when the tutor connection is available.",
              })),
            );
        next = yield* markNotebookProposalAcknowledged(next, entry.id);
        return yield* save(next, epoch);
      }),
    );
  }
  function exportNotebook() {
    if (!current.current) return;
    const decoded = Schema.decodeUnknownEither(KnowledgeNotebookSchema)(current.current);
    if (Either.isLeft(decoded)) {
      setMessage(
        "This notebook could not be validated for export. Its saved record remains untouched.",
      );
      return;
    }
    const exported = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(decoded.right, null, 2)], { type: "application/json" }),
            );
            const link = document.createElement("a");
            link.href = url;
            link.download = "recall-private-knowledge-notebook.json";
            link.click();
            URL.revokeObjectURL(url);
          },
          catch: () => ({
            message: "The notebook could not be exported. Your evidence remains available.",
          }),
        }),
      ),
    );
    if (Either.isLeft(exported)) setMessage(exported.left.message);
  }
  function clear() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    const epoch = alive.current;
    void Effect.runPromise(Effect.either(demo ? Effect.void : store.clear())).then((result) => {
      if (epoch !== alive.current) return;
      if (Either.isLeft(result)) setMessage(result.left.message);
      else {
        publish(null);
        setDrafts({});
        setGoal("");
        setClearConfirm(false);
        setUnsaved(false);
      }
      working.current = false;
      setBusy(false);
    });
  }

  return (
    <section
      ref={searchRoot}
      className="space-y-5 rounded-xl border border-border bg-card p-4 sm:p-6 lg:p-7 [&_[data-slot=label]]:grid [&_[data-slot=label]]:items-start [&_[data-slot=label]]:gap-2 [&_[data-slot=label]]:leading-[1.4] [&_[data-slot=textarea]]:w-full [&_[data-slot=input]]:w-full"
      aria-label="Knowledge notebook"
    >
      <div className="space-y-2">
        <h2 className="m-0 max-w-2xl text-2xl font-semibold leading-tight tracking-tight sm:text-[1.75rem]">
          Build understanding, then useful cards
        </h2>
        <p className="m-0 max-w-2xl text-sm leading-6 text-muted-foreground">
          Explore what you understand, investigate gaps and choose which cards to keep. Assessments
          are provisional and tied to your actual answers or reviews.
        </p>
      </div>
      <h2 className="text-xl font-semibold">
        {activity === "practice"
          ? "Practice"
          : activity === "materials"
            ? "Study materials"
            : "Review suggestions"}
      </h2>
      <Tabs
        className="my-0"
        value={activity}
        onValueChange={(value) => {
          if (value === "practice" || value === "materials" || value === "suggestions")
            setActivity(value);
        }}
      >
        <TabsList
          className="flex h-auto w-fit max-w-full flex-wrap gap-1 p-1"
          aria-label="Study activities"
        >
          {(
            [
              ["practice", "Practice"],
              ["materials", "Study materials"],
              ["suggestions", "Review suggestions"],
            ] as const
          ).map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
              {value === "suggestions" && pendingProposals.length > 0
                ? ` (${pendingProposals.length})`
                : ""}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="grid gap-3" hidden={notebook !== null && activity !== "practice"}>
        {!notebook ? (
          <div className="grid gap-3">
            <Label>
              What do you want to understand?
              <Textarea
                value={goal}
                maxLength={2000}
                onChange={(event) => setGoal(event.target.value)}
                placeholder="Explain how energy moves through a cell and apply it to unfamiliar examples."
              />
            </Label>
          </div>
        ) : (
          <>
            <Collapsible>
              <CollapsibleTrigger className="w-full text-left font-medium">
                Study goal
              </CollapsibleTrigger>
              <CollapsibleContent>
                <p className="whitespace-pre-wrap">{notebook.goal}</p>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
        {!active && (
          <Collapsible>
            <CollapsibleTrigger className="w-full text-left font-medium">
              Session limits
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="grid gap-3 sm:grid-cols-3">
                <Label>
                  Questions
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={questionLimit}
                    onChange={(event) => setQuestionLimit(event.target.value)}
                  />
                </Label>
                <Label>
                  AI requests
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={requestLimit}
                    onChange={(event) => setRequestLimit(event.target.value)}
                  />
                </Label>
                <Label>
                  Minutes
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                  />
                </Label>
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        {!active && (
          <Button
            className="w-full sm:w-fit sm:min-w-36"
            type="button"
            variant="primary"
            disabled={busy || !loaded || unsaved || (!notebook && !goal.trim())}
            onClick={begin}
          >
            {notebook ? "Start practice" : "Start"}
          </Button>
        )}
      </div>
      {notebook && (
        <>
          <div hidden={activity !== "practice"}>
            <Collapsible>
              <CollapsibleTrigger className="w-full text-left font-medium">
                Session progress
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-wrap gap-3 py-3">
                  <span>
                    {notebook.session.askedQuestions}/{notebook.session.maxQuestions} questions
                  </span>
                  <span>
                    {notebook.session.requestsUsed}/{notebook.session.maxRequests} AI requests
                  </span>
                  <span>
                    {Math.floor(elapsed / 60_000)}/
                    {Math.floor(notebook.session.maximumDurationMs / 60_000)} minutes
                  </span>
                </div>
              </CollapsibleContent>
            </Collapsible>
            {(expired || exhausted) && (
              <Alert role="status">
                <AlertDescription>
                  Session limit reached. Finish this session or start another.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <div hidden={activity !== "materials"}>
            <StudyMaterialsPanel
              notebook={notebook}
              knowledgeArea={knowledgeArea}
              api={api}
              disabled={busy || unsaved}
              networkDisabled={networkDisabled || notebook.session.phase === "idle"}
              save={save}
              run={run}
              clock={clock}
            />
          </div>
          <div hidden={activity !== "practice"}>
            <Collapsible className="my-6 list-none p-0">
              <CollapsibleTrigger className="w-full text-left font-medium">
                Concepts ({notebook.concepts.length})
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ul className="list-none p-0">
                  {notebook.concepts.map((concept) => {
                    const assessment = assessments.find((entry) => entry.conceptId === concept.id);
                    const parent = notebook.concepts.find((entry) => entry.id === concept.parentId);
                    const linkedIds = new Set(
                      notebook.evidence
                        .filter((entry) => entry.conceptId === concept.id)
                        .flatMap((entry) => entry.linkedCardIds),
                    );
                    const sourceCards = knowledgeArea.cards.filter(
                      (card) =>
                        linkedIds.has(card.id) ||
                        (concept.objectiveId != null &&
                          card.objectiveIds.includes(concept.objectiveId)) ||
                        (String(concept.id) === String(notebook.areaId) &&
                          concept.parentId === null &&
                          card.objectiveIds.length === 0),
                    );
                    return (
                      <li
                        key={concept.id}
                        tabIndex={-1}
                        data-search-target={`concept:${concept.id}`}
                        className="border-b py-3 [&_p]:my-1.5"
                      >
                        <Collapsible>
                          <CollapsibleTrigger className="w-full text-left font-medium">
                            {concept.title} ·{" "}
                            {assessment?.status.replaceAll("-", " ") ?? "unassessed"}
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            {parent && <p>Within {parent.title}</p>}
                            {concept.prerequisiteIds.length > 0 && (
                              <p>
                                Builds on:{" "}
                                {concept.prerequisiteIds
                                  .map(
                                    (id) =>
                                      notebook.concepts.find((entry) => entry.id === id)?.title ??
                                      "Unknown concept",
                                  )
                                  .join(", ")}
                              </p>
                            )}
                            <p>
                              {assessment?.status.replaceAll("-", " ") ?? "unassessed"} ·{" "}
                              {assessment?.evidenceCount ?? 0} observations
                            </p>
                            <small>{assessment?.reason}</small>
                            <Collapsible>
                              <CollapsibleTrigger className="w-full text-left font-medium">
                                Library coverage · {sourceCards.length} cards
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                {sourceCards.map((card) => (
                                  <div key={card.id} className="whitespace-pre-wrap py-2">
                                    {card.kind === "basic" ? (
                                      <>
                                        <strong>{card.front}</strong>
                                        <p>{card.back}</p>
                                      </>
                                    ) : (
                                      <p>{card.text}</p>
                                    )}
                                  </div>
                                ))}
                              </CollapsibleContent>
                            </Collapsible>
                            {concept.id === notebook.session.targetConceptId && (
                              <p>Current focus · {notebook.session.mode}</p>
                            )}
                          </CollapsibleContent>
                        </Collapsible>
                      </li>
                    );
                  })}
                </ul>
                <div className="flex flex-wrap gap-3">
                  <Label>
                    Add a concept
                    <Input
                      value={conceptTitle}
                      onChange={(event) => setConceptTitle(event.target.value)}
                    />
                  </Label>
                  <Label>
                    Within
                    <NativeSelect
                      value={parentId}
                      onChange={(event) => setParentId(event.target.value)}
                    >
                      <option value="">Map root</option>
                      {notebook.concepts.map((concept) => (
                        <option key={concept.id} value={concept.id}>
                          {concept.title}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    disabled={busy || unsaved || !conceptTitle.trim()}
                    onClick={addConcept}
                  >
                    Add concept
                  </Button>
                </div>
              </CollapsibleContent>
            </Collapsible>
            {active && (
              <div className="grid gap-4">
                {pendingQuestion ? (
                  <>
                    {pendingQuestion.explanation && (
                      <div className="whitespace-pre-wrap">
                        <h3 className="text-base font-semibold">Worked explanation</h3>
                        <p>{pendingQuestion.explanation}</p>
                      </div>
                    )}
                    <h3 className="text-base font-semibold">{pendingQuestion.question}</h3>
                    <Collapsible>
                      <CollapsibleTrigger className="w-full text-left font-medium">
                        About this question
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <p>{pendingQuestion.teachingIntent}</p>
                      </CollapsibleContent>
                    </Collapsible>
                    {(pendingQuestion.conceptSuggestions?.length ?? 0) > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger className="w-full text-left font-medium">
                          Suggested concepts
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          {pendingQuestion.conceptSuggestions?.map((suggestion) => (
                            <div key={suggestion.title}>
                              <strong>{suggestion.title}</strong>
                              <p>{suggestion.description}</p>
                              <Button
                                type="button"
                                variant="secondary"
                                size="small"
                                disabled={
                                  busy ||
                                  notebook.concepts.some(
                                    (concept) =>
                                      concept.parentId === notebook.session.targetConceptId &&
                                      concept.title.trim().toLowerCase() ===
                                        suggestion.title.trim().toLowerCase(),
                                  )
                                }
                                onClick={() =>
                                  acceptSuggestedConcept(suggestion.title, suggestion.description)
                                }
                              >
                                Add concept
                              </Button>
                            </div>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                    <Label>
                      Your answer
                      <Textarea
                        value={answer}
                        onChange={(event) => setAnswer(event.target.value)}
                        maxLength={8000}
                      />
                    </Label>
                    <Label>
                      How confident are you?
                      <NativeSelect
                        value={confidence}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "guess" || value === "unsure" || value === "confident")
                            setConfidence(value);
                        }}
                      >
                        <option value="guess">A guess</option>
                        <option value="unsure">Unsure</option>
                        <option value="confident">Confident</option>
                      </NativeSelect>
                    </Label>
                    <div className="flex flex-wrap gap-3">
                      <Button
                        type="button"
                        variant="primary"
                        disabled={networkDisabled || !answer.trim()}
                        onClick={() => submitAnswer(answer)}
                      >
                        Check answer
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="small"
                        disabled={busy || unsaved}
                        onClick={() => {
                          if (current.current)
                            run(
                              updateNotebookAnswerDraft(current.current, {
                                answer,
                                learnerConfidence: confidence,
                              }).pipe(Effect.flatMap(save)),
                            );
                        }}
                      >
                        Save answer draft
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="small"
                        disabled={networkDisabled}
                        onClick={() => submitAnswer("I don't know yet.", "guess")}
                      >
                        I don’t know
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button type="button" variant="primary" disabled={questionDisabled} onClick={ask}>
                    Ask the next useful question
                  </Button>
                )}
                <div className="flex flex-wrap gap-3 py-3">
                  {(["deeper", "explain", "skip", "finish"] as const).map((action) => (
                    <Button
                      type="button"
                      variant="secondary"
                      size="small"
                      disabled={busy || unsaved || (action === "explain" && questionDisabled)}
                      key={action}
                      onClick={() => control(action)}
                    >
                      {action === "deeper"
                        ? "Go deeper"
                        : action === "explain"
                          ? "Explain first"
                          : action === "skip"
                            ? "Skip this concept"
                            : "Finish investigation"}
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {lastEvidence?.kind === "tutor" && (
              <div className="mt-5 border-t py-4">
                <h3 className="text-base font-semibold">Latest feedback</h3>
                <p className="whitespace-pre-wrap">{lastEvidence.evaluation.feedback}</p>
                {lastEvidence.evaluation.misconception && (
                  <p>Unresolved misconception: {lastEvidence.evaluation.misconception}</p>
                )}
              </div>
            )}
            <Collapsible>
              <CollapsibleTrigger className="w-full text-left font-medium">
                Answer history · {notebook.evidence.length} observations
              </CollapsibleTrigger>
              <CollapsibleContent>
                {notebook.evidence.map((entry) => (
                  <article
                    key={entry.id}
                    tabIndex={-1}
                    data-search-target={`conversation:${entry.id}`}
                    className="border-b py-3"
                  >
                    <strong>
                      {notebook.concepts.find((concept) => concept.id === entry.conceptId)?.title}
                    </strong>
                    {entry.kind === "tutor" ? (
                      <>
                        <p>{entry.question}</p>
                        <p className="whitespace-pre-wrap">
                          Your answer: {entry.answer || "No answer"}
                        </p>
                        <p>{entry.evaluation.feedback}</p>
                      </>
                    ) : (
                      <p>Saved review · rating {entry.reviewEvent.rating}</p>
                    )}
                    <small>{entry.linkedCardIds.length} linked cards</small>
                  </article>
                ))}
              </CollapsibleContent>
            </Collapsible>
          </div>
          <div hidden={activity !== "suggestions"}>
            <h3 className="text-base font-semibold">Review suggestions</h3>
            {pendingProposals.length === 0 && <p>No suggestions to review.</p>}
            <Button
              type="button"
              variant="secondary"
              size="small"
              disabled={
                networkDisabled ||
                notebook.session.phase === "idle" ||
                pendingQuestion != null ||
                !assessments.some(
                  (entry) => entry.status === "uncertain" || entry.status === "needs-reinforcement",
                )
              }
              onClick={proposeGaps}
            >
              Generate cards for gaps
            </Button>
            {pendingProposals.map((entry) => {
              const draft = drafts[entry.id] ?? entry.proposal;
              const duplicates = proposalDuplicates(entry, draft);
              return (
                <article
                  key={entry.id}
                  tabIndex={-1}
                  data-search-target={`suggestion:${entry.id}`}
                  className="mt-5 border-t py-4"
                >
                  <p>
                    {notebook.concepts.find((concept) => concept.id === entry.conceptId)?.title} ·{" "}
                    {entry.sourceReferences?.length
                      ? `${entry.sourceReferences.length} supporting source passages`
                      : `${entry.evidenceIds.length} supporting observations`}
                  </p>
                  {entry.sourceReferences?.map((reference, index) => {
                    const material = notebook.materials?.find(
                      (item) => item.id === reference.materialId,
                    );
                    const section = material?.sections.find(
                      (item) => item.id === reference.sectionId,
                    );
                    return (
                      <Collapsible key={index}>
                        <CollapsibleTrigger className="w-full text-left font-medium">
                          Source: {material?.name}
                          {reference.pageNumber ? ` · page ${reference.pageNumber}` : ""}
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <blockquote>
                            <p className="whitespace-pre-wrap">{reference.quote}</p>
                            <a
                              href={`#study-source-${reference.sectionId}`}
                              onClick={() => {
                                setActivity("materials");
                                const source = document.getElementById(
                                  `study-source-${reference.sectionId}`,
                                );
                                if (source instanceof HTMLDetailsElement) {
                                  source.open = true;
                                  window.requestAnimationFrame(() =>
                                    source.scrollIntoView({ block: "start" }),
                                  );
                                }
                              }}
                            >
                              {material?.name} · {section?.title}
                              {reference.pageNumber ? ` · page ${reference.pageNumber}` : ""} · open
                              source passage
                            </a>
                          </blockquote>
                        </CollapsibleContent>
                      </Collapsible>
                    );
                  })}
                  <Label>
                    Question
                    <Textarea
                      disabled={busy}
                      value={draft.front}
                      maxLength={1000}
                      onChange={(event) =>
                        editProposal(entry.id, { ...draft, front: event.target.value })
                      }
                    />
                  </Label>
                  <Label>
                    Answer
                    <Textarea
                      disabled={busy}
                      value={draft.back}
                      maxLength={3000}
                      onChange={(event) =>
                        editProposal(entry.id, { ...draft, back: event.target.value })
                      }
                    />
                  </Label>
                  <Label>
                    Learning objective
                    <NativeSelect
                      disabled={busy}
                      value={draft.objectiveId ?? ""}
                      onChange={(event) =>
                        editProposal(entry.id, {
                          ...draft,
                          objectiveId: event.target.value
                            ? createObjectiveId(event.target.value)
                            : null,
                        })
                      }
                    >
                      <option value="">No library objective</option>
                      {knowledgeArea.objectives.map((objective) => (
                        <option key={objective.id} value={objective.id}>
                          {objective.title}
                        </option>
                      ))}
                    </NativeSelect>
                  </Label>
                  <Label>
                    Why keep it?
                    <Textarea
                      disabled={busy}
                      value={draft.rationale}
                      maxLength={1000}
                      onChange={(event) =>
                        editProposal(entry.id, { ...draft, rationale: event.target.value })
                      }
                    />
                  </Label>
                  <CardAssistancePanel
                    proposal={draft}
                    duplicateCandidates={duplicateCandidates}
                    knowledgeArea={knowledgeArea}
                    api={api}
                    notebook={notebook}
                    saveNotebook={save}
                    disabled={busy || unsaved}
                    networkDisabled={networkDisabled}
                    onBusyChange={(value) => {
                      working.current = value;
                      setBusy(value);
                    }}
                    sources={(entry.sourceReferences ?? []).slice(0, 1).flatMap((reference) => {
                      const material = notebook.materials?.find(
                        (item) => item.id === reference.materialId,
                      );
                      const section = material?.sections.find(
                        (item) => item.id === reference.sectionId,
                      );
                      return section
                        ? [
                            {
                              materialId: reference.materialId,
                              sectionId: reference.sectionId,
                              text: section.text,
                              pageNumber: section.pageNumber,
                            },
                          ]
                        : [];
                    })}
                    onApply={async (result) => {
                      const latest = current.current;
                      if (!latest) return false;
                      const resultSaved = await Effect.runPromise(
                        Effect.either(
                          applyNotebookRefinement(
                            latest,
                            {
                              proposalId: entry.id,
                              baseline: entry.proposal,
                              cards: result.cards,
                              newProposalIds: result.cards.map(() => crypto.randomUUID()),
                            },
                            knowledgeArea.cards,
                          ).pipe(Effect.flatMap(save)),
                        ),
                      );
                      if (Either.isLeft(resultSaved)) {
                        setMessage(resultSaved.left.message);
                        return false;
                      }
                      setDrafts((previous) => {
                        const next = { ...previous };
                        delete next[entry.id];
                        return next;
                      });
                      return true;
                    }}
                  />
                  <ProposalDuplicateWarning
                    matches={duplicates.matches}
                    acknowledged={duplicates.acknowledged}
                    disabled={busy || unsaved}
                    onChange={(value) =>
                      setDuplicateAcknowledgements((previous) => ({
                        ...previous,
                        [entry.id]: value ? duplicates.key : "",
                      }))
                    }
                  />
                  <div className="flex flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="secondary"
                      size="small"
                      disabled={busy || unsaved}
                      onClick={() => saveProposalEdits(entry)}
                    >
                      Save proposal edits
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      disabled={
                        busy ||
                        unsaved ||
                        (duplicates.matches.length > 0 && !duplicates.acknowledged)
                      }
                      onClick={() => resolve(entry, "accepted")}
                    >
                      Accept and save card
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="small"
                      disabled={busy}
                      onClick={() => resolve(entry, "discarded")}
                    >
                      Discard
                    </Button>
                  </div>
                </article>
              );
            })}
            {accepted.length > 0 && (
              <>
                <p>{accepted.length} cards saved to your library.</p>
                {accepted
                  .filter((entry) => !entry.providerAcknowledged)
                  .map((entry) => (
                    <Button
                      variant="secondary"
                      size="small"
                      type="button"
                      key={entry.id}
                      disabled={busy}
                      onClick={() => resolve(entry, "accepted")}
                    >
                      Retry confirmation: {entry.proposal.front}
                    </Button>
                  ))}
                {onStartReview && (
                  <Button type="button" variant="primary" onClick={onStartReview}>
                    Review cards
                  </Button>
                )}
              </>
            )}
            {notebook.proposals
              .filter((entry) => entry.status === "discarded" && !entry.providerAcknowledged)
              .map((entry) => (
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  key={entry.id}
                  disabled={busy}
                  onClick={() => resolve(entry, "discarded")}
                >
                  Retry discard confirmation: {entry.proposal.front}
                </Button>
              ))}
          </div>
          <Collapsible>
            <CollapsibleTrigger className="w-full text-left font-medium">
              Manage notebook
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="flex flex-wrap gap-3 py-3">
                <Button type="button" variant="secondary" size="small" onClick={exportNotebook}>
                  Export notebook
                </Button>
                {unsaved && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="small"
                    disabled={busy}
                    onClick={() => {
                      if (current.current) run(save(current.current));
                    }}
                  >
                    Retry saving notebook
                  </Button>
                )}
                <Button
                  type="button"
                  variant="secondary"
                  size="small"
                  disabled={busy}
                  onClick={() => setClearConfirm(true)}
                >
                  Clear notebook
                </Button>
              </div>
              <p>
                This private device notebook is saved separately from workspace backups. Export it
                to keep your investigation evidence.
              </p>
              {clearConfirm && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Clear this notebook’s map, answers and proposals? Approved library cards and
                    review history remain. Export the notebook first if you want to keep it.
                  </AlertDescription>
                  <Button type="button" disabled={busy} onClick={clear}>
                    Confirm clear notebook
                  </Button>
                  <Button type="button" disabled={busy} onClick={() => setClearConfirm(false)}>
                    Cancel
                  </Button>
                </Alert>
              )}
            </CollapsibleContent>
          </Collapsible>
        </>
      )}
      {(!loaded || unsaved) && !demo && (
        <div>
          {unsaved && (
            <p>
              Export current work before reloading; reloading replaces changes that have not been
              saved.
            </p>
          )}
          <Button
            type="button"
            variant="secondary"
            size="small"
            disabled={busy}
            onClick={reloadNotebook}
          >
            Retry loading saved notebook
          </Button>
        </div>
      )}
      {busy && (
        <Alert role="status">
          <AlertDescription>Saving or investigating…</AlertDescription>
        </Alert>
      )}
      {unsaved && (
        <Alert role="status">
          <AlertDescription>
            Notebook changes remain in this view until saved. Export them before leaving.
          </AlertDescription>
        </Alert>
      )}
      {message && (
        <Alert className="mt-2" variant="destructive">
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
    </section>
  );
}
