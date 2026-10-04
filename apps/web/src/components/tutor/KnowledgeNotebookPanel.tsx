"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Effect, Either, Schema } from "effect";
import {
  addNotebookConcepts,
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
} from "@recall/application";
import { CardProposalSchema, cardIdForTutorProposal, type CardProposal } from "@recall/ai-core";
import {
  createCardId,
  createObjectiveId,
  type KnowledgeArea,
  type ReviewEvent,
} from "@recall/domain";
import { createBrowserKnowledgeNotebookStore } from "@/lib/knowledge-notebook-store";
import { tutorApi } from "@/lib/tutor-api";
import { StudyMaterialsPanel } from "./StudyMaterialsPanel";

export type KnowledgeNotebookPanelProps = {
  readonly knowledgeArea: KnowledgeArea;
  readonly api?: typeof tutorApi;
  readonly sessionNamespace?: string;
  readonly reviewEvents?: readonly ReviewEvent[];
  readonly initialNotebook?: KnowledgeNotebook;
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
  api = tutorApi,
  sessionNamespace = "hosted",
  reviewEvents = noReviews,
  initialNotebook,
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
          cardId: createCardId(cardId),
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
    <section className="tutor-panel" aria-label="Knowledge notebook">
      <p className="eyebrow">INVESTIGATE · PRACTISE · REMEMBER</p>
      <h2>Build understanding, then useful cards</h2>
      <p>
        Explore what you understand, investigate gaps and choose which cards to keep. Assessments
        are provisional and tied to your actual answers or reviews.
      </p>
      {!notebook ? (
        <div className="grid gap-3">
          <label>
            What do you want to understand?
            <textarea
              value={goal}
              maxLength={2000}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Explain how energy moves through a cell and apply it to unfamiliar examples."
            />
          </label>
        </div>
      ) : (
        <>
          <h3>Your goal</h3>
          <p className="whitespace-pre-wrap">{notebook.goal}</p>
        </>
      )}
      {!active && (
        <div className="grid gap-3 sm:grid-cols-3">
          <label>
            Question budget
            <input
              type="number"
              min={1}
              max={100}
              value={questionLimit}
              onChange={(event) => setQuestionLimit(event.target.value)}
            />
          </label>
          <label>
            AI request budget
            <input
              type="number"
              min={1}
              max={500}
              value={requestLimit}
              onChange={(event) => setRequestLimit(event.target.value)}
            />
          </label>
          <label>
            Minutes
            <input
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </label>
        </div>
      )}
      {!active && (
        <button
          type="button"
          className="primary-button"
          disabled={busy || !loaded || unsaved || (!notebook && !goal.trim())}
          onClick={begin}
        >
          {notebook ? "Start another investigation" : "Create knowledge map"}
        </button>
      )}
      {notebook && (
        <>
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
          {(expired || exhausted) && (
            <p role="status">
              Your investigation budget is complete. Keep the evidence, finish this session or start
              a new one deliberately.
            </p>
          )}
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
          <h3>Knowledge map</h3>
          <ul className="grid list-none gap-3 p-0 sm:grid-cols-2">
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
                <li key={concept.id} className="rounded-xl border border-stone-200 p-3">
                  <strong>{concept.title}</strong>
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
                  <details>
                    <summary>Library coverage · {sourceCards.length} cards</summary>
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
                  </details>
                  {concept.id === notebook.session.targetConceptId && (
                    <p>Current focus · {notebook.session.mode}</p>
                  )}
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap gap-3">
            <label>
              Add a concept
              <input
                value={conceptTitle}
                onChange={(event) => setConceptTitle(event.target.value)}
              />
            </label>
            <label>
              Within
              <select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">Map root</option>
                {notebook.concepts.map((concept) => (
                  <option key={concept.id} value={concept.id}>
                    {concept.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="text-button"
              disabled={busy || unsaved || !conceptTitle.trim()}
              onClick={addConcept}
            >
              Add concept
            </button>
          </div>
          {active && (
            <div className="tutor-gaps">
              {pendingQuestion ? (
                <>
                  {pendingQuestion.explanation && (
                    <div className="whitespace-pre-wrap rounded-xl bg-stone-50 p-3">
                      <h3>Worked explanation</h3>
                      <p>{pendingQuestion.explanation}</p>
                    </div>
                  )}
                  <h3>{pendingQuestion.question}</h3>
                  <p>{pendingQuestion.teachingIntent}</p>
                  {(pendingQuestion.conceptSuggestions?.length ?? 0) > 0 && (
                    <div>
                      <h4>Possible next concepts</h4>
                      <p>These are suggestions. Add only concepts useful for your goal.</p>
                      {pendingQuestion.conceptSuggestions?.map((suggestion) => (
                        <div key={suggestion.title}>
                          <strong>{suggestion.title}</strong>
                          <p>{suggestion.description}</p>
                          <button
                            type="button"
                            className="text-button"
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
                            Add to knowledge map
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label>
                    Your answer
                    <textarea
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      maxLength={8000}
                    />
                  </label>
                  <label>
                    How confident are you?
                    <select
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
                    </select>
                  </label>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      className="primary-button"
                      disabled={networkDisabled || !answer.trim()}
                      onClick={() => submitAnswer(answer)}
                    >
                      Check understanding
                    </button>
                    <button
                      type="button"
                      className="text-button"
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
                    </button>
                    <button
                      type="button"
                      className="text-button"
                      disabled={networkDisabled}
                      onClick={() => submitAnswer("I don't know yet.", "guess")}
                    >
                      I don’t know
                    </button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  className="primary-button"
                  disabled={questionDisabled}
                  onClick={ask}
                >
                  Ask the next useful question
                </button>
              )}
              <div className="flex flex-wrap gap-3 py-3">
                {(["deeper", "explain", "skip", "finish"] as const).map((action) => (
                  <button
                    type="button"
                    className="text-button"
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
                  </button>
                ))}
              </div>
            </div>
          )}
          {lastEvidence?.kind === "tutor" && (
            <div className="tutor-gaps">
              <h3>Latest feedback</h3>
              <p className="whitespace-pre-wrap">{lastEvidence.evaluation.feedback}</p>
              {lastEvidence.evaluation.misconception && (
                <p>Unresolved misconception: {lastEvidence.evaluation.misconception}</p>
              )}
              <p>
                Evidence: {lastEvidence.learnerConfidence} answer · {lastEvidence.evaluation.result}
                ; this is not a permanent mastery label.
              </p>
            </div>
          )}
          <details>
            <summary>Evidence notebook · {notebook.evidence.length} observations</summary>
            {notebook.evidence.map((entry) => (
              <article key={entry.id} className="border-b border-stone-200 py-3">
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
          </details>
          <h3>Cards supported by your gaps</h3>
          <p>
            Propose only what your evidence supports. Equivalent existing cards and repeated
            proposals are checked; there is no fixed deck size.
          </p>
          <button
            type="button"
            className="text-button"
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
            Propose cards for observed gaps
          </button>
          {pendingProposals.map((entry) => {
            const draft = drafts[entry.id] ?? entry.proposal;
            return (
              <article key={entry.id} className="tutor-gaps">
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
                    <blockquote key={index}>
                      <p className="whitespace-pre-wrap">{reference.quote}</p>
                      <a
                        href={`#study-source-${reference.sectionId}`}
                        onClick={() => {
                          const source = document.getElementById(
                            `study-source-${reference.sectionId}`,
                          );
                          if (source instanceof HTMLDetailsElement) source.open = true;
                        }}
                      >
                        {material?.name} · {section?.title}
                        {reference.pageNumber ? ` · page ${reference.pageNumber}` : ""} · open
                        source passage
                      </a>
                    </blockquote>
                  );
                })}
                <label>
                  Question
                  <textarea
                    disabled={busy}
                    value={draft.front}
                    maxLength={1000}
                    onChange={(event) =>
                      editProposal(entry.id, { ...draft, front: event.target.value })
                    }
                  />
                </label>
                <label>
                  Answer
                  <textarea
                    disabled={busy}
                    value={draft.back}
                    maxLength={3000}
                    onChange={(event) =>
                      editProposal(entry.id, { ...draft, back: event.target.value })
                    }
                  />
                </label>
                <label>
                  Learning objective
                  <select
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
                  </select>
                </label>
                <label>
                  Why keep it?
                  <textarea
                    disabled={busy}
                    value={draft.rationale}
                    maxLength={1000}
                    onChange={(event) =>
                      editProposal(entry.id, { ...draft, rationale: event.target.value })
                    }
                  />
                </label>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy || unsaved}
                    onClick={() => saveProposalEdits(entry)}
                  >
                    Save proposal edits
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={busy || unsaved}
                    onClick={() => resolve(entry, "accepted")}
                  >
                    Accept and save card
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    disabled={busy}
                    onClick={() => resolve(entry, "discarded")}
                  >
                    Discard
                  </button>
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
                  <button
                    className="text-button"
                    type="button"
                    key={entry.id}
                    disabled={busy}
                    onClick={() => resolve(entry, "accepted")}
                  >
                    Retry confirmation: {entry.proposal.front}
                  </button>
                ))}
              {onStartReview && (
                <button type="button" className="primary-button" onClick={onStartReview}>
                  Start reviewing saved cards
                </button>
              )}
            </>
          )}
          {notebook.proposals
            .filter((entry) => entry.status === "discarded" && !entry.providerAcknowledged)
            .map((entry) => (
              <button
                type="button"
                className="text-button"
                key={entry.id}
                disabled={busy}
                onClick={() => resolve(entry, "discarded")}
              >
                Retry discard confirmation: {entry.proposal.front}
              </button>
            ))}
          <div className="flex flex-wrap gap-3 py-3">
            <button type="button" className="text-button" onClick={exportNotebook}>
              Export private notebook JSON
            </button>
            {unsaved && (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (current.current) run(save(current.current));
                }}
              >
                Retry saving notebook
              </button>
            )}
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => setClearConfirm(true)}
            >
              Clear notebook
            </button>
          </div>
          <p>
            This private device notebook is saved separately from workspace backups. Export it to
            keep your investigation evidence.
          </p>
          {clearConfirm && (
            <div role="alert">
              <p>
                Clear this notebook’s map, answers and proposals? Approved library cards and review
                history remain. Export the notebook first if you want to keep it.
              </p>
              <button type="button" disabled={busy} onClick={clear}>
                Confirm clear notebook
              </button>
              <button type="button" disabled={busy} onClick={() => setClearConfirm(false)}>
                Cancel
              </button>
            </div>
          )}
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
          <button type="button" className="text-button" disabled={busy} onClick={reloadNotebook}>
            Retry loading saved notebook
          </button>
        </div>
      )}
      {busy && <p role="status">Saving or investigating…</p>}
      {unsaved && (
        <p role="status">
          Notebook changes remain in this view until saved. Export them before leaving.
        </p>
      )}
      {message && (
        <p role="alert" className="tutor-error">
          {message}
        </p>
      )}
    </section>
  );
}
