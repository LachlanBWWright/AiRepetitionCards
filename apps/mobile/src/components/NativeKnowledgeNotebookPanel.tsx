import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Effect, Either, Schema } from "effect";
import { NativeButton } from "@recall/ui-native";
import type { KnowledgeArea, ReviewEvent } from "@recall/domain";
import {
  KnowledgeNotebookSchema,
  addNotebookConcepts,
  appendNotebookReviewEvidence,
  beginNotebookSession,
  controlNotebookSession,
  createKnowledgeNotebookTutor,
  deriveNotebookAssessments,
  editNotebookProposal,
  markNotebookProposalAcknowledged,
  resolveNotebookProposal,
  seedKnowledgeNotebook,
  selectNotebookTarget,
  updateNotebookAnswerDraft,
  type KnowledgeNotebook,
  type NotebookAssessment,
} from "@recall/application";
import type { CardProposal } from "@recall/ai-core";
import { CardProposalSchema } from "@recall/ai-core";
import { createObjectiveId } from "@recall/domain";
import { designTokens } from "@recall/design-tokens";
import type { makeNativeTutorApi } from "../storage/native-tutor-api";
import {
  clearNativeKnowledgeNotebooks,
  readNativeKnowledgeNotebook,
  writeNativeKnowledgeNotebook,
} from "../storage/native-knowledge-notebook-store";
import { shareKnowledgeNotebook } from "../storage/native-interchange";
import { NativeStudyMaterialsPanel } from "./NativeStudyMaterialsPanel";

const palette = designTokens.color;
type TutorApi = ReturnType<typeof makeNativeTutorApi>;
const failureMessage =
  "The notebook could not be updated. Your saved cards and review history are unchanged.";

export function NativeKnowledgeNotebookPanel({
  area,
  reviewEvents,
  api,
  createId,
  mayWrite,
  onApproveProposal,
  onStartReview,
}: {
  readonly onStartReview?: (() => void) | undefined;
  readonly area: KnowledgeArea;
  readonly reviewEvents: readonly ReviewEvent[];
  readonly api: TutorApi | null;
  readonly createId: () => string;
  readonly mayWrite: () => boolean;
  readonly onApproveProposal: (
    proposal: CardProposal,
    proposalId: string,
    sessionId: string,
  ) => Promise<{ readonly cardId: string; readonly content: CardProposal } | null>;
}) {
  const [notebook, setNotebook] = useState<KnowledgeNotebook | null>(null);
  const [goal, setGoal] = useState(area.title);
  const [maxQuestions, setMaxQuestions] = useState("30");
  const [maxRequests, setMaxRequests] = useState("100");
  const [durationMinutes, setDurationMinutes] = useState("30");
  const [unsaved, setUnsaved] = useState<KnowledgeNotebook | null>(null);
  const notebookRef = useRef<KnowledgeNotebook | null>(null);
  notebookRef.current = notebook;
  const [answer, setAnswer] = useState("");
  const [confidence, setConfidence] = useState<"guess" | "unsure" | "confident">("unsure");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [conceptTitle, setConceptTitle] = useState("");
  const [proposalDraft, setProposalDraft] = useState<{
    readonly proposalId: string;
    readonly content: CardProposal;
  } | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const actionLocked = useRef(false);
  useEffect(() => {
    generation.current += 1;
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, [area.id]);
  const assessments = useMemo(() => {
    if (!notebook) return [] as readonly NotebookAssessment[];
    const result = Effect.runSync(Effect.either(deriveNotebookAssessments(notebook)));
    return Either.isRight(result) ? result.right : [];
  }, [notebook]);
  const activeTarget = notebook
    ? Effect.runSync(Effect.either(selectNotebookTarget(notebook, Date.now())))
    : null;
  const latestEvidence = notebook?.evidence.at(-1);
  const pendingProposal = notebook?.proposals.find((proposal) => proposal.status === "pending");
  const proposalContent = pendingProposal
    ? proposalDraft?.proposalId === pendingProposal.id
      ? proposalDraft.content
      : pendingProposal.proposal
    : null;

  useEffect(() => {
    let active = true;
    void Effect.runPromise(Effect.either(readNativeKnowledgeNotebook(area.id))).then((result) => {
      if (!active) return;
      if (Either.isLeft(result)) {
        setLoadFailed(true);
        setNotice(
          "The local notebook could not be read or validated. Its saved bytes were preserved.",
        );
      } else if (result.right !== null) {
        const decoded = Schema.decodeUnknownEither(KnowledgeNotebookSchema)(result.right);
        if (Either.isRight(decoded) && decoded.right.areaId === area.id) {
          setNotebook(decoded.right);
          setAnswer(decoded.right.session.draftAnswer ?? "");
          setConfidence(decoded.right.session.draftConfidence ?? "unsure");
        } else {
          setLoadFailed(true);
          setNotice("The saved notebook is invalid. It was preserved and has not been replaced.");
        }
      }
      setLoaded(true);
    });
    return () => {
      active = false;
    };
  }, [area.id]);

  const save = useCallback(
    async (next: KnowledgeNotebook): Promise<boolean> => {
      const savedGeneration = generation.current;
      const decoded = Schema.decodeUnknownEither(KnowledgeNotebookSchema)(next);
      if (
        Either.isLeft(decoded) ||
        decoded.right.areaId !== area.id ||
        !mayWrite() ||
        !mounted.current
      ) {
        setNotice(failureMessage);
        return false;
      }
      const result = await Effect.runPromise(
        Effect.either(writeNativeKnowledgeNotebook(area.id, decoded.right, mayWrite)),
      );
      if (!mounted.current || generation.current !== savedGeneration) return false;
      if (Either.isLeft(result)) {
        setUnsaved(decoded.right);
        setNotebook(decoded.right);
        setNotice(failureMessage);
        return false;
      }
      setUnsaved(null);
      notebookRef.current = decoded.right;
      setNotebook(decoded.right);
      return true;
    },
    [area.id, mayWrite],
  );

  useEffect(() => {
    if (!notebook || !loaded || unsaved || actionLocked.current || reviewEvents.length === 0)
      return;
    const result = Effect.runSync(
      Effect.either(appendNotebookReviewEvidence(notebook, area, reviewEvents)),
    );
    if (Either.isRight(result) && result.right.evidence.length !== notebook.evidence.length)
      void runAction(async () => {
        await save(result.right);
      });
  }, [area, loaded, notebook, reviewEvents, unsaved, save]);

  async function runAction(operation: (isCurrent: () => boolean) => Promise<void>) {
    if (actionLocked.current) return;
    actionLocked.current = true;
    const actionGeneration = generation.current;
    const isCurrent = () => mounted.current && generation.current === actionGeneration;
    if (isCurrent()) setBusy(true);
    try {
      await operation(isCurrent);
    } finally {
      actionLocked.current = false;
      if (isCurrent()) setBusy(false);
    }
  }

  async function start() {
    const seeded = notebook
      ? Either.right(notebook)
      : Effect.runSync(Effect.either(seedKnowledgeNotebook(area, goal.trim())));
    if (Either.isLeft(seeded)) {
      setNotice("Add a learning goal first.");
      return;
    }
    const begun = Effect.runSync(
      Effect.either(
        beginNotebookSession(seeded.right, {
          startedAt: Date.now(),
          maxQuestions: Number(maxQuestions),
          maxRequests: Number(maxRequests),
          maximumDurationMs: Number(durationMinutes) * 60_000,
        }),
      ),
    );
    if (Either.isRight(begun)) await save(begun.right);
    else setNotice("Use 1–100 questions, 1–500 requests and 1–1440 minutes.");
  }

  async function addManualConcept() {
    if (!notebook || conceptTitle.trim().length === 0) return;
    const result = Effect.runSync(
      Effect.either(
        addNotebookConcepts(notebook, [
          {
            id: createObjectiveId(createId()),
            title: conceptTitle.trim(),
            description: null,
            parentId: null,
            prerequisiteIds: [],
          },
        ]),
      ),
    );
    if (Either.isLeft(result)) {
      setNotice("Concepts must have a unique title of at most 200 characters.");
      return;
    }
    if (await save(result.right)) setConceptTitle("");
  }

  async function approveSuggestedConcept(suggestion: {
    readonly title: string;
    readonly description: string;
  }) {
    if (!notebook) return;
    const conceptId = createObjectiveId(createId());
    const result = Effect.runSync(
      Effect.either(
        addNotebookConcepts(notebook, [
          {
            id: conceptId,
            title: suggestion.title,
            description: suggestion.description,
            parentId: null,
            prerequisiteIds: [],
          },
        ]),
      ),
    );
    if (Either.isLeft(result)) {
      setNotice("The suggested concept could not be validated.");
      return;
    }
    if (await save(result.right))
      setNotice(`Added “${suggestion.title}” to the notebook for your next investigation.`);
  }

  async function ask() {
    await runAction(async (isCurrent) => askAction(isCurrent));
  }

  async function askAction(isCurrent: () => boolean) {
    if (!notebook || !api || !mayWrite() || unsaved) {
      setNotice(
        api
          ? failureMessage
          : "The tutor is unavailable offline. Your local notebook remains available.",
      );
      return;
    }
    setNotice(null);
    const tutor = createKnowledgeNotebookTutor(api, persistBeforeRequest);
    const response = await Effect.runPromise(
      Effect.either(tutor.ask(notebook, { knowledgeArea: area }, Date.now())),
    );
    if (!isCurrent()) return;
    if (Either.isLeft(response)) {
      if (response.left.notebook) {
        setNotebook(response.left.notebook);
        await save(response.left.notebook);
      }
      setNotice(response.left.message);
      return;
    }
    await save(response.right);
  }

  async function answerQuestion(
    value: string,
    learnerConfidence: "guess" | "unsure" | "confident",
  ) {
    await runAction(async (isCurrent) => answerQuestionAction(value, learnerConfidence, isCurrent));
  }

  async function answerQuestionAction(
    value: string,
    learnerConfidence: "guess" | "unsure" | "confident",
    isCurrent: () => boolean,
  ) {
    if (!notebook || !api || !mayWrite() || unsaved) return;
    setNotice(null);
    const draft = Effect.runSync(
      Effect.either(updateNotebookAnswerDraft(notebook, { answer: value, learnerConfidence })),
    );
    if (Either.isLeft(draft) || !(await save(draft.right)) || !isCurrent()) return;
    const tutor = createKnowledgeNotebookTutor(api, persistBeforeRequest);
    const evidenceId = createId();
    const response = await Effect.runPromise(
      Effect.either(
        tutor.answer(draft.right, { answer: value, learnerConfidence, evidenceId }, Date.now()),
      ),
    );
    if (!isCurrent()) return;
    if (Either.isLeft(response)) {
      if (response.left.notebook) {
        setNotebook(response.left.notebook);
        await save(response.left.notebook);
      }
      setNotice(response.left.message);
      return;
    }
    setAnswer("");
    await save(response.right);
  }

  function persistBeforeRequest(value: unknown) {
    return writeNativeKnowledgeNotebook(area.id, value, () => mounted.current && mayWrite()).pipe(
      Effect.mapError(() => ({ message: failureMessage }) as const),
    );
  }

  async function saveAnswerDraft() {
    if (!notebook) return;
    const result = Effect.runSync(
      Effect.either(updateNotebookAnswerDraft(notebook, { answer, learnerConfidence: confidence })),
    );
    if (Either.isLeft(result)) setNotice(result.left.message);
    else if (await save(result.right)) setNotice("Answer draft saved privately on this device.");
  }

  async function saveProposalEdits() {
    if (!notebook || !pendingProposal || !proposalContent) return;
    const edited = Effect.runSync(
      Effect.either(
        editNotebookProposal(
          notebook,
          { id: pendingProposal.id, proposal: proposalContent },
          area.cards,
        ),
      ),
    );
    if (Either.isLeft(edited)) setNotice(edited.left.message);
    else if (await save(edited.right)) {
      setProposalDraft(null);
      setNotice("Proposal edits saved locally.");
    }
  }

  async function proposeBatch() {
    if (!notebook || !api || unsaved || !mayWrite()) return;
    await runAction(async (isCurrent) => {
      const ids = notebook.evidence
        .filter(
          (entry) =>
            entry.kind === "tutor" &&
            entry.evaluation.suggestedAction === "propose-card" &&
            !notebook.proposals.some(
              (proposal) =>
                proposal.status !== "discarded" && proposal.evidenceIds.includes(entry.id),
            ),
        )
        .map((entry) => entry.id)
        .slice(0, 100);
      const result = await Effect.runPromise(
        Effect.either(
          createKnowledgeNotebookTutor(api, persistBeforeRequest).proposeBatch(
            notebook,
            ids,
            area.cards,
            Date.now,
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) {
        if (result.left.notebook) await save(result.left.notebook);
        setNotice(result.left.message);
      } else await save(result.right);
    });
  }

  async function control(action: "deeper" | "explain" | "skip" | "finish") {
    if (!notebook) return;
    const result = Effect.runSync(
      Effect.either(controlNotebookSession(notebook, { action, now: Date.now() })),
    );
    if (Either.isRight(result)) await save(result.right);
  }

  async function resolveProposal(status: "accepted" | "discarded") {
    await runAction(async (isCurrent) => resolveProposalAction(status, isCurrent));
  }

  async function resolveProposalAction(status: "accepted" | "discarded", isCurrent: () => boolean) {
    if (!notebook || !pendingProposal || unsaved || !mayWrite()) return;
    if (status === "accepted") {
      const edited = Schema.decodeUnknownEither(CardProposalSchema)({
        ...proposalContent,
        front: proposalContent?.front.trim(),
        back: proposalContent?.back.trim(),
        rationale: proposalContent?.rationale.trim(),
      });
      if (
        Either.isLeft(edited) ||
        (edited.right.objectiveId !== null &&
          !area.objectives.some((objective) => objective.id === edited.right.objectiveId))
      ) {
        setNotice("Review the question, answer, rationale and learning objective before saving.");
        return;
      }
      if (!pendingProposal.providerSessionId) {
        setNotice("This proposal is missing its session identity and cannot be approved.");
        return;
      }
      const saved = await onApproveProposal(
        edited.right,
        pendingProposal.id,
        pendingProposal.providerSessionId,
      );
      if (!isCurrent()) return;
      if (!saved) {
        setNotice("The proposal was not approved because its card could not be saved locally.");
        return;
      }
      const approved = Effect.runSync(
        Effect.either(
          resolveNotebookProposal(notebook, {
            id: pendingProposal.id,
            status: "accepted",
            cardId: saved.cardId,
            proposal: saved.content,
          }),
        ),
      );
      if (Either.isRight(approved)) {
        if (await save(approved.right))
          await acknowledgeProposal(
            approved.right.proposals.find((item) => item.id === pendingProposal.id) ??
              pendingProposal,
            isCurrent,
            approved.right,
          );
      } else
        setNotice(
          "The card is saved, but the notebook link could not be updated. Retry after refreshing.",
        );
      return;
    }
    const locallyDiscarded = Effect.runSync(
      Effect.either(
        resolveNotebookProposal(notebook, { id: pendingProposal.id, status: "discarded" }),
      ),
    );
    if (Either.isLeft(locallyDiscarded) || !(await save(locallyDiscarded.right))) return;
    if (
      !api ||
      !pendingProposal.providerSessionId ||
      pendingProposal.providerResolutionRequired === false
    )
      return;
    const rejected = await Effect.runPromise(
      Effect.either(api.resolveProposal({ proposalId: pendingProposal.id, state: "rejected" })),
    );
    if (!isCurrent()) return;
    if (Either.isLeft(rejected)) {
      setNotice("The proposal could not be discarded on the tutor service.");
      return;
    }
    const acknowledged = Effect.runSync(
      Effect.either(markNotebookProposalAcknowledged(locallyDiscarded.right, pendingProposal.id)),
    );
    if (Either.isRight(acknowledged)) await save(acknowledged.right);
  }

  async function acknowledgeProposal(
    proposal: NonNullable<typeof pendingProposal>,
    isCurrent: () => boolean,
    base = notebookRef.current,
  ) {
    if (
      !api ||
      !proposal.providerSessionId ||
      !base ||
      proposal.providerResolutionRequired === false
    )
      return;
    const result = await Effect.runPromise(
      Effect.either(
        api.resolveProposal({
          proposalId: proposal.id,
          state: proposal.status === "accepted" ? "approved" : "rejected",
          ...(proposal.status === "accepted"
            ? { cardId: proposal.cardId ?? undefined, content: proposal.proposal }
            : {}),
        }),
      ),
    );
    if (!isCurrent()) return;
    if (Either.isLeft(result)) {
      setNotice("The decision is saved locally. Retry acknowledgement with the tutor.");
      return;
    }
    const current = notebookRef.current ?? base;
    if (!current) return;
    const marked = Effect.runSync(
      Effect.either(markNotebookProposalAcknowledged(current, proposal.id)),
    );
    if (Either.isRight(marked)) await save(marked.right);
  }

  function clearNotebook() {
    Alert.alert("Clear this notebook?", "Approved cards and review history will stay saved.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Clear notebook",
        style: "destructive",
        onPress: () => {
          void runAction(async (isCurrent) => {
            const result = await Effect.runPromise(
              Effect.either(clearNativeKnowledgeNotebooks([area.id], mayWrite)),
            );
            if (!isCurrent()) return;
            if (Either.isRight(result)) {
              setNotebook(null);
              setUnsaved(null);
              setLoadFailed(false);
              setNotice(
                "This private notebook was cleared. Saved cards and review history remain.",
              );
            } else setNotice("The notebook could not be cleared.");
          });
        },
      },
    ]);
  }

  return (
    <View testID="native-knowledge-notebook" style={styles.panel}>
      <View style={styles.heading}>
        <View>
          <Text style={styles.eyebrow}>ADAPTIVE STUDY</Text>
          <Text style={styles.title}>Knowledge notebook</Text>
        </View>
        <Text style={styles.private}>Private on this device</Text>
      </View>
      <Text style={styles.muted}>
        Investigate concepts, track evidence, then decide which cards to keep.
      </Text>
      <NativeStudyMaterialsPanel
        notebook={notebook}
        area={area}
        api={api}
        goal={goal}
        createId={createId}
        disabled={busy || !loaded || loadFailed || !!unsaved || !mayWrite()}
        save={save}
        persistBeforeRequest={persistBeforeRequest}
        runAction={runAction}
      />
      {unsaved ? (
        <NativeButton
          disabled={busy}
          onPress={() =>
            void runAction(async () => {
              await save(unsaved);
            })
          }
          label="Retry saving notebook"
          style={styles.button}
          labelStyle={styles.buttonText}
        />
      ) : null}
      {!notebook || notebook.session.phase !== "active" ? (
        <View style={styles.row}>
          <TextInput
            accessibilityLabel="Question limit"
            keyboardType="number-pad"
            value={maxQuestions}
            onChangeText={setMaxQuestions}
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="AI request limit"
            keyboardType="number-pad"
            value={maxRequests}
            onChangeText={setMaxRequests}
            style={styles.input}
          />
          <TextInput
            accessibilityLabel="Session minutes"
            keyboardType="number-pad"
            value={durationMinutes}
            onChangeText={setDurationMinutes}
            style={styles.input}
          />
        </View>
      ) : null}
      {loadFailed ? (
        <NativeButton
          disabled={busy || !mayWrite()}
          onPress={clearNotebook}
          label="Clear unreadable notebook"
          style={styles.softButton}
          labelStyle={styles.softText}
        />
      ) : null}
      {!notebook ? (
        <>
          <TextInput
            accessibilityLabel="Learning goal"
            onChangeText={setGoal}
            value={goal}
            style={styles.input}
            placeholder="What do you want to understand?"
          />
          <NativeButton
            disabled={busy || !loaded || loadFailed || !mayWrite()}
            onPress={() =>
              void runAction(async (isCurrent) => {
                if (isCurrent()) await start();
              })
            }
            label="Start investigation"
            style={styles.button}
            labelStyle={styles.buttonText}
          />
        </>
      ) : (
        <>
          <View style={styles.row}>
            <TextInput
              accessibilityLabel="Add a concept"
              onChangeText={setConceptTitle}
              value={conceptTitle}
              style={[styles.input, styles.conceptInput]}
              placeholder="Add a concept"
            />
            <NativeButton
              disabled={busy || !mayWrite()}
              onPress={() =>
                void runAction(async (isCurrent) => {
                  if (isCurrent()) await addManualConcept();
                })
              }
              label="Add"
              style={styles.softButton}
              labelStyle={styles.softText}
            />
          </View>
          <NativeButton
            disabled={busy}
            onPress={() =>
              void Effect.runPromise(Effect.either(shareKnowledgeNotebook(notebook))).then(
                (result) => {
                  if (mounted.current)
                    setNotice(
                      Either.isRight(result)
                        ? "Notebook JSON shared. Keep it private; it contains learning history."
                        : "Notebook export is unavailable.",
                    );
                },
              )
            }
            label="Export notebook JSON"
            style={styles.softButton}
            labelStyle={styles.softText}
          />
          <Text style={styles.goal}>{notebook.goal}</Text>
          {notebook.session.phase === "finished" ? (
            <View style={styles.feedback}>
              <Text style={styles.conceptTitle}>Investigation complete</Text>
              <Text style={styles.muted}>
                {notebook.evidence.length} evidence items ·{" "}
                {notebook.proposals.filter((item) => item.status === "accepted").length} approved
                cards · {notebook.proposals.filter((item) => item.status === "pending").length}{" "}
                proposals to review
              </Text>
              {onStartReview ? (
                <NativeButton
                  disabled={busy || !!unsaved}
                  onPress={onStartReview}
                  label="Start reviewing saved cards"
                  style={styles.button}
                  labelStyle={styles.buttonText}
                />
              ) : null}
            </View>
          ) : null}
          <Text style={styles.muted}>
            {notebook.session.phase === "active"
              ? `Question ${notebook.session.askedQuestions}/${notebook.session.maxQuestions} · ${notebook.session.requestsUsed}/${notebook.session.maxRequests} tutor requests`
              : notebook.session.phase === "finished"
                ? "Investigation finished · evidence stays saved"
                : "Investigation ready"}
          </Text>
          <ScrollView style={styles.concepts}>
            {notebook.concepts.map((concept) => {
              const assessment = assessments.find((item) => item.conceptId === concept.id);
              return (
                <View key={concept.id} style={styles.concept}>
                  <Text style={styles.conceptTitle}>{concept.title}</Text>
                  <Text style={styles.muted}>
                    {assessment?.status ?? "unassessed"} · {assessment?.evidenceCount ?? 0} evidence
                    item(s)
                  </Text>
                  {concept.parentId ? (
                    <Text style={styles.muted}>
                      Within:{" "}
                      {notebook.concepts.find((item) => item.id === concept.parentId)?.title ??
                        concept.parentId}
                    </Text>
                  ) : null}
                  {concept.prerequisiteIds.length > 0 ? (
                    <Text style={styles.muted}>
                      Prerequisites:{" "}
                      {concept.prerequisiteIds
                        .map((id) => notebook.concepts.find((item) => item.id === id)?.title ?? id)
                        .join(", ")}
                    </Text>
                  ) : null}
                  {assessment?.reason ? (
                    <Text style={styles.muted}>{assessment.reason}</Text>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          {notebook.session.phase !== "active" ? (
            <NativeButton
              disabled={busy || !mayWrite()}
              onPress={() =>
                void runAction(async (isCurrent) => {
                  if (isCurrent()) await start();
                })
              }
              label="Continue with a new session"
              style={styles.button}
              labelStyle={styles.buttonText}
            />
          ) : notebook.session.pendingQuestion ? (
            <View style={styles.question}>
              {notebook.session.mode === "explain" &&
              notebook.session.pendingQuestion.explanation ? (
                <Text style={styles.response}>{notebook.session.pendingQuestion.explanation}</Text>
              ) : null}
              <Text style={styles.conceptTitle}>{notebook.session.pendingQuestion.question}</Text>
              {notebook.session.pendingQuestion.conceptSuggestions?.map((suggestion, index) => (
                <View key={`${suggestion.title}:${index}`} style={styles.suggestion}>
                  <Text style={styles.conceptTitle}>Suggested concept: {suggestion.title}</Text>
                  <Text style={styles.muted}>{suggestion.description}</Text>
                  <NativeButton
                    disabled={busy || !mayWrite()}
                    onPress={() =>
                      void runAction(async (isCurrent) => {
                        if (isCurrent()) await approveSuggestedConcept(suggestion);
                      })
                    }
                    label="Add suggested concept"
                    style={styles.softButton}
                    labelStyle={styles.softText}
                  />
                </View>
              ))}
              <TextInput
                accessibilityLabel="Your answer"
                multiline
                onChangeText={setAnswer}
                value={answer}
                style={styles.input}
                placeholder="Write your answer, or choose I don't know"
              />
              <NativeButton
                disabled={busy || !!unsaved || !mayWrite()}
                onPress={() =>
                  void runAction(async () => {
                    await saveAnswerDraft();
                  })
                }
                label="Save answer draft"
                style={styles.softButton}
                labelStyle={styles.softText}
              />
              <Text style={styles.muted}>How sure are you?</Text>
              <View style={styles.row}>
                {(["guess", "unsure", "confident"] as const).map((item) => (
                  <NativeButton
                    key={item}
                    onPress={() => setConfidence(item)}
                    label={`${confidence === item ? "✓ " : ""}${item}`}
                    style={styles.softButton}
                    labelStyle={styles.softText}
                  />
                ))}
              </View>
              <View style={styles.row}>
                <NativeButton
                  disabled={busy || !api || !mayWrite()}
                  onPress={() => void answerQuestion(answer, confidence)}
                  label="Submit answer"
                  style={styles.button}
                  labelStyle={styles.buttonText}
                />
                <NativeButton
                  disabled={busy || !api || !mayWrite()}
                  onPress={() => void answerQuestion("I don't know", "guess")}
                  label="I don't know"
                  style={styles.softButton}
                  labelStyle={styles.softText}
                />
              </View>
              {!api ? (
                <Text style={styles.muted}>
                  Tutor unavailable offline. Your notebook and existing evidence remain readable.
                </Text>
              ) : null}
            </View>
          ) : (
            <View style={styles.question}>
              {activeTarget && Either.isRight(activeTarget) && activeTarget.right ? (
                <Text style={styles.muted}>
                  Next focus:{" "}
                  {
                    notebook.concepts.find((item) => item.id === activeTarget.right?.conceptId)
                      ?.title
                  }
                </Text>
              ) : null}
              <NativeButton
                disabled={busy || !api || !mayWrite()}
                onPress={() => void ask()}
                label="Ask adaptive question"
                style={styles.button}
                labelStyle={styles.buttonText}
              />
              {!api ? (
                <Text style={styles.muted}>
                  Tutor unavailable offline; no AI response is simulated.
                </Text>
              ) : null}
            </View>
          )}
          <View style={styles.row}>
            {(["deeper", "explain", "skip", "finish"] as const).map((action) => (
              <NativeButton
                key={action}
                disabled={busy || !!unsaved || !mayWrite() || notebook.session.phase !== "active"}
                onPress={() =>
                  void runAction(async () => {
                    await control(action);
                  })
                }
                label={action}
                style={styles.softButton}
                labelStyle={styles.softText}
              />
            ))}
          </View>
          <NativeButton
            disabled={busy || !!unsaved || !api || !mayWrite()}
            onPress={() => void proposeBatch()}
            label="Propose cards from unresolved gaps"
            style={styles.softButton}
            labelStyle={styles.softText}
          />
          {notebook.proposals
            .filter(
              (item) =>
                item.status !== "pending" &&
                !item.providerAcknowledged &&
                item.providerResolutionRequired !== false,
            )
            .map((item) => (
              <NativeButton
                key={item.id}
                disabled={busy || !api || !mayWrite()}
                onPress={() =>
                  void runAction(async (isCurrent) => {
                    await acknowledgeProposal(item, isCurrent);
                  })
                }
                label={`Retry tutor acknowledgement · ${item.status}`}
                style={styles.softButton}
                labelStyle={styles.softText}
              />
            ))}
          {latestEvidence?.kind === "tutor" ? (
            <View style={styles.feedback}>
              <Text style={styles.conceptTitle}>
                Tutor feedback · {latestEvidence.evaluation.result}
              </Text>
              <Text style={styles.response}>{latestEvidence.evaluation.feedback}</Text>
              <Text style={styles.muted}>
                Model confidence: {Math.round(latestEvidence.evaluation.confidence * 100)}%. This is
                not a measured probability of mastery.
              </Text>
              {latestEvidence.evaluation.misconception ? (
                <Text style={styles.muted}>
                  Possible misconception: {latestEvidence.evaluation.misconception}
                </Text>
              ) : null}
            </View>
          ) : null}
          {notebook.evidence.length > 0 ? (
            <View style={styles.feedback}>
              <Text style={styles.conceptTitle}>Recent recorded evidence</Text>
              {notebook.evidence
                .slice(-10)
                .reverse()
                .map((entry) => (
                  <View key={entry.id} style={styles.concept}>
                    <Text style={styles.conceptTitle}>
                      {notebook.concepts.find((item) => item.id === entry.conceptId)?.title}
                    </Text>
                    {entry.kind === "tutor" ? (
                      <>
                        <Text style={styles.response}>{entry.question}</Text>
                        <Text style={styles.muted}>
                          Your answer: {entry.answer} · {entry.learnerConfidence}
                        </Text>
                        <Text style={styles.response}>{entry.evaluation.feedback}</Text>
                      </>
                    ) : (
                      <Text style={styles.muted}>Review rating: {entry.reviewEvent.rating}</Text>
                    )}
                  </View>
                ))}
            </View>
          ) : null}
          {pendingProposal ? (
            <View style={styles.proposal}>
              <Text style={styles.conceptTitle}>Proposed card · approval required</Text>
              {pendingProposal.sourceReferences?.map((reference, index) => {
                const source = notebook.materials?.find((item) => item.id === reference.materialId);
                const passage = source?.sections.find((item) => item.id === reference.sectionId);
                return (
                  <View key={index} style={styles.feedback}>
                    <Text style={styles.conceptTitle}>
                      Source: {source?.name} · {passage?.title}
                      {reference.pageNumber ? ` · page ${reference.pageNumber}` : ""}
                    </Text>
                    <Text selectable style={styles.response}>
                      {reference.quote}
                    </Text>
                    <Text selectable style={styles.muted}>
                      {passage?.text}
                    </Text>
                  </View>
                );
              })}
              <TextInput
                accessibilityLabel="Proposal question"
                value={proposalContent?.front ?? ""}
                onChangeText={(front) => {
                  if (proposalContent)
                    setProposalDraft({
                      proposalId: pendingProposal.id,
                      content: { ...proposalContent, front },
                    });
                }}
                editable={!busy}
                style={styles.input}
              />
              <TextInput
                accessibilityLabel="Proposal answer"
                value={proposalContent?.back ?? ""}
                onChangeText={(back) => {
                  if (proposalContent)
                    setProposalDraft({
                      proposalId: pendingProposal.id,
                      content: { ...proposalContent, back },
                    });
                }}
                editable={!busy}
                multiline
                style={styles.input}
              />
              <Text style={styles.muted}>
                Evidence: {pendingProposal.evidenceIds.length} linked item(s). Review before saving.
              </Text>
              <NativeButton
                disabled={busy || !!unsaved || !mayWrite()}
                onPress={() =>
                  void runAction(async () => {
                    await saveProposalEdits();
                  })
                }
                label="Save proposal edits"
                style={styles.softButton}
                labelStyle={styles.softText}
              />
              <View style={styles.row}>
                <NativeButton
                  disabled={busy || !!unsaved || !mayWrite()}
                  onPress={() => void resolveProposal("accepted")}
                  label="Save & approve"
                  style={styles.button}
                  labelStyle={styles.buttonText}
                />
                <NativeButton
                  disabled={busy || !!unsaved || !mayWrite()}
                  onPress={() => void resolveProposal("discarded")}
                  label="Discard proposal"
                  style={styles.softButton}
                  labelStyle={styles.softText}
                />
              </View>
            </View>
          ) : null}
          <NativeButton
            disabled={busy}
            onPress={clearNotebook}
            label="Clear notebook"
            style={styles.softButton}
            labelStyle={styles.softText}
          />
        </>
      )}
      {busy ? <Text style={styles.muted}>Saving…</Text> : null}
      {notice ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 11,
    marginTop: 18,
    padding: 16,
    borderRadius: 20,
    backgroundColor: palette.surface,
    borderColor: palette.line,
    borderWidth: 1,
  },
  heading: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  eyebrow: { color: palette.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  title: { color: palette.ink, fontSize: 18, fontWeight: "700" },
  private: { color: palette.darkGreen, fontSize: 10, fontWeight: "700" },
  goal: { color: palette.ink, fontSize: 14, fontWeight: "700" },
  muted: { color: palette.muted, fontSize: 11, lineHeight: 16 },
  input: {
    minHeight: 42,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: palette.paper,
    color: palette.ink,
  },
  button: {
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 13,
    borderRadius: 10,
    backgroundColor: palette.darkGreen,
  },
  buttonText: { color: palette.surface, fontSize: 12, fontWeight: "700" },
  softButton: {
    minHeight: 36,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: palette.green,
  },
  softText: { color: palette.darkGreen, fontSize: 11, fontWeight: "700" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  conceptInput: { flex: 1 },
  suggestion: { gap: 6, padding: 8 },
  concepts: { maxHeight: 190 },
  concept: { gap: 3, paddingVertical: 7, borderBottomColor: palette.line, borderBottomWidth: 1 },
  conceptTitle: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  question: { gap: 8, padding: 11, borderRadius: 12, backgroundColor: palette.paper },
  feedback: { gap: 7, padding: 11, borderRadius: 12, backgroundColor: palette.paper },
  response: { color: palette.ink, fontSize: 13, lineHeight: 19 },
  proposal: { gap: 7, padding: 11, borderColor: palette.line, borderWidth: 1, borderRadius: 12 },
  notice: {
    color: palette.darkGreen,
    backgroundColor: "#eaf3d9",
    padding: 9,
    borderRadius: 9,
    fontSize: 12,
  },
});
