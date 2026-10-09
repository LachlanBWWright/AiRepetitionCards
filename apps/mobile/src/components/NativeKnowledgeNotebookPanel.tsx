import { NativeButton } from "./ui/NativeButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { Effect, Either, Schema } from "effect";
import type { KnowledgeArea, ReviewEvent } from "@recall/domain";
import {
  findCardDuplicates,
  knowledgeAreaDuplicateCandidates,
  proposalDuplicateCandidates,
  type CardDuplicateCandidate,
  type WorkspaceSearchTarget,
  KnowledgeNotebookSchema,
  addNotebookConcepts,
  appendNotebookReviewEvidence,
  beginNotebookSession,
  controlNotebookSession,
  createKnowledgeNotebookTutor,
  createCardAssistanceTutor,
  applyNotebookRefinement,
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
import type {
  CardProposal,
  CardRefinementInput,
  CardRefinementResult,
  CardInspectionResult,
  StudySourcePassage,
} from "@recall/ai-core";
import { CardProposalSchema, cardIdForTutorProposal } from "@recall/ai-core";
import { createObjectiveId } from "@recall/domain";
import type { makeNativeTutorApi } from "../storage/native-tutor-api";
import {
  clearNativeKnowledgeNotebooks,
  readNativeKnowledgeNotebook,
  writeNativeKnowledgeNotebook,
} from "../storage/native-knowledge-notebook-store";
import { shareKnowledgeNotebook } from "../storage/native-interchange";
import { NativeProposalDuplicateWarning } from "./NativeProposalDuplicateWarning";
import { NativeCardAssistancePanel } from "./NativeCardAssistancePanel";
import { NativeStudyMaterialsPanel } from "./NativeStudyMaterialsPanel";

const NotebookSection = {
  Practice: "Practice",
  StudyMaterials: "Study materials",
  ReviewSuggestions: "Review suggestions",
} as const;
type NotebookSection = (typeof NotebookSection)[keyof typeof NotebookSection];
const notebookSections = [
  NotebookSection.Practice,
  NotebookSection.StudyMaterials,
  NotebookSection.ReviewSuggestions,
] as const satisfies readonly NotebookSection[];
type TutorApi = ReturnType<typeof makeNativeTutorApi>;
const failureMessage =
  "The notebook could not be updated. Your saved cards and review history are unchanged.";

export function NativeKnowledgeNotebookPanel({
  area,
  searchTarget,
  duplicateCandidates = knowledgeAreaDuplicateCandidates(area),
  storageNamespace = "knowledge-notebook",
  reviewEvents,
  api,
  createId,
  mayWrite,
  onApproveProposal,
  onStartReview,
}: {
  readonly onStartReview?: (() => void) | undefined;
  readonly area: KnowledgeArea;
  readonly searchTarget?: WorkspaceSearchTarget | undefined;
  readonly duplicateCandidates?: readonly CardDuplicateCandidate[];
  readonly storageNamespace?: string;
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
  const [section, setSection] = useState<NotebookSection>(
    storageNamespace === "knowledge-notebook"
      ? NotebookSection.Practice
      : NotebookSection.ReviewSuggestions,
  );
  const [duplicateAcknowledgement, setDuplicateAcknowledgement] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showConcepts, setShowConcepts] = useState(false);
  const [expandedConceptId, setExpandedConceptId] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);
  const [showSources, setShowSources] = useState(false);
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
  }, [area.id, storageNamespace]);
  const assessments = useMemo(() => {
    if (!notebook) return [] as readonly NotebookAssessment[];
    const result = Effect.runSync(Effect.either(deriveNotebookAssessments(notebook)));
    return Either.isRight(result) ? result.right : [];
  }, [notebook]);
  const activeTarget = notebook
    ? Effect.runSync(Effect.either(selectNotebookTarget(notebook, Date.now())))
    : null;
  const latestEvidence = notebook?.evidence.at(-1);
  const pendingProposal =
    (searchTarget?.kind === "suggestion"
      ? notebook?.proposals.find(
          (proposal) => proposal.id === searchTarget.proposalId && proposal.status === "pending",
        )
      : undefined) ?? notebook?.proposals.find((proposal) => proposal.status === "pending");
  useEffect(() => {
    if (
      !searchTarget ||
      !("namespace" in searchTarget) ||
      searchTarget.namespace !== storageNamespace
    )
      return;
    const frame = requestAnimationFrame(() => {
      if (
        searchTarget.kind === "material" ||
        searchTarget.kind === "passage" ||
        searchTarget.kind === "claim"
      ) {
        setSection(NotebookSection.StudyMaterials);
      } else if (searchTarget.kind === "suggestion") {
        setSection(NotebookSection.ReviewSuggestions);
        setShowSources(true);
      } else {
        setSection(NotebookSection.Practice);
        setShowConcepts(true);
        if (searchTarget.kind === "concept" || searchTarget.kind === "conversation")
          setExpandedConceptId(searchTarget.conceptId);
        if (searchTarget.kind === "conversation") setShowEvidence(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [searchTarget, storageNamespace]);
  const searchedConcept =
    searchTarget?.kind === "concept"
      ? notebook?.concepts.find((item) => item.id === searchTarget.conceptId)
      : null;
  const searchedEvidence =
    searchTarget?.kind === "conversation"
      ? notebook?.evidence.find((item) => item.id === searchTarget.evidenceId)
      : null;
  const searchedProposal =
    searchTarget?.kind === "suggestion"
      ? notebook?.proposals.find((item) => item.id === searchTarget.proposalId)
      : null;
  const proposalContent = pendingProposal
    ? proposalDraft?.proposalId === pendingProposal.id
      ? proposalDraft.content
      : pendingProposal.proposal
    : null;

  const ownCardId = pendingProposal ? cardIdForTutorProposal(pendingProposal.id) : null;
  const duplicateMatches = proposalContent
    ? findCardDuplicates(
        proposalContent,
        [
          ...duplicateCandidates,
          ...proposalDuplicateCandidates(
            (notebook?.proposals ?? [])
              .filter((item) => item.id !== pendingProposal?.id && item.status === "pending")
              .map((item) => ({ id: `proposal:${item.id}`, proposal: item.proposal })),
          ),
        ],
        ownCardId ? { excludeCardId: ownCardId } : {},
      )
    : [];
  const duplicateKey = JSON.stringify([
    pendingProposal?.id,
    proposalContent?.front,
    proposalContent?.back,
    duplicateMatches.map((match) => match.candidate),
  ]);
  const duplicatesAllowed =
    duplicateMatches.length === 0 || duplicateAcknowledgement === duplicateKey;

  useEffect(() => {
    let active = true;
    void Effect.runPromise(
      Effect.either(readNativeKnowledgeNotebook(area.id, storageNamespace)),
    ).then((result) => {
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
  }, [area.id, storageNamespace]);

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
        Effect.either(
          writeNativeKnowledgeNotebook(area.id, decoded.right, mayWrite, storageNamespace),
        ),
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
    [area.id, mayWrite, storageNamespace],
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
    return writeNativeKnowledgeNotebook(
      area.id,
      value,
      () => mounted.current && mayWrite(),
      storageNamespace,
    ).pipe(Effect.mapError(() => ({ message: failureMessage }) as const));
  }

  function assistanceSources(): readonly StudySourcePassage[] {
    const reference = pendingProposal?.sourceReferences?.[0];
    if (!reference) return [];
    const source = notebook?.materials
      ?.find((item) => item.id === reference.materialId)
      ?.sections.find((item) => item.id === reference.sectionId);
    return source
      ? [
          {
            materialId: reference.materialId,
            sectionId: reference.sectionId,
            text: source.text,
            pageNumber: source.pageNumber,
          },
        ]
      : [];
  }

  async function refineProposal(mode: CardRefinementInput["mode"], instructions: string) {
    let response: CardRefinementResult | null = null;
    if (!notebook || !proposalContent || !api) return response;
    await runAction(async (isCurrent) => {
      const result = await Effect.runPromise(
        Effect.either(
          createCardAssistanceTutor(api, persistBeforeRequest).refine(
            notebook,
            { knowledgeArea: area, history: [] },
            { ...proposalContent, mode, instructions, sources: assistanceSources() },
            Date.now(),
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) {
        if (result.left.notebook) await save(result.left.notebook);
        setNotice(result.left.message);
      } else if (result.right.notebook && (await save(result.right.notebook)))
        response = result.right.result;
    });
    return response;
  }

  async function inspectProposal() {
    let response: CardInspectionResult | null = null;
    if (!notebook || !proposalContent || !api) return response;
    await runAction(async (isCurrent) => {
      const result = await Effect.runPromise(
        Effect.either(
          createCardAssistanceTutor(api, persistBeforeRequest).inspect(
            notebook,
            { knowledgeArea: area, history: [] },
            { ...proposalContent, sources: assistanceSources() },
            Date.now(),
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(result)) {
        if (result.left.notebook) await save(result.left.notebook);
        setNotice(result.left.message);
      } else if (result.right.notebook && (await save(result.right.notebook)))
        response = result.right.result;
    });
    return response;
  }

  async function applyRefinement(result: CardRefinementResult) {
    let applied = false;
    if (!notebook || !pendingProposal || !proposalContent) return false;
    await runAction(async (isCurrent) => {
      const next = Effect.runSync(
        Effect.either(
          applyNotebookRefinement(
            notebook,
            {
              proposalId: pendingProposal.id,
              baseline: {
                front: pendingProposal.proposal.front,
                back: pendingProposal.proposal.back,
                objectiveId: pendingProposal.proposal.objectiveId,
              },
              cards: result.cards,
              newProposalIds: result.cards.length > 1 ? result.cards.map(() => createId()) : [],
            },
            area.cards,
          ),
        ),
      );
      if (!isCurrent()) return;
      if (Either.isLeft(next)) setNotice(next.left.message);
      else if (await save(next.right)) {
        setProposalDraft(null);
        applied = true;
        setNotice(
          "Refined proposals saved. Review and approve each before adding it to your deck.",
        );
      }
    });
    return applied;
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
      if (!duplicatesAllowed) {
        setNotice("Review the possible duplicates and choose Keep both before saving.");
        return;
      }
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
    <View testID="native-knowledge-notebook" className={"gap-[11px] mt-[12px]"}>
      {searchedConcept ? (
        <View accessibilityLiveRegion="polite" className={"gap-[11px]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>{searchedConcept.title}</Text>
          {searchedConcept.description ? (
            <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
              {searchedConcept.description}
            </Text>
          ) : null}
        </View>
      ) : null}
      {searchedEvidence ? (
        <View accessibilityLiveRegion="polite" className={"gap-[11px]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>Selected discussion</Text>
          {searchedEvidence.kind === "tutor" ? (
            <>
              <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                {searchedEvidence.question}
              </Text>
              <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                Your answer: {searchedEvidence.answer}
              </Text>
              <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                {searchedEvidence.evaluation.feedback}
              </Text>
            </>
          ) : (
            <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
              Review rating: {searchedEvidence.reviewEvent.rating}
            </Text>
          )}
        </View>
      ) : null}
      {searchedProposal && searchedProposal.status !== "pending" ? (
        <View accessibilityLiveRegion="polite" className={"gap-[11px]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>
            {searchedProposal.proposal.front}
          </Text>
          <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
            {searchedProposal.proposal.back}
          </Text>
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
            {searchedProposal.status}
          </Text>
        </View>
      ) : null}
      <View className={"flex-row flex-wrap gap-[7px]"}>
        {notebookSections.map((item) => (
          <NativeButton
            key={item}
            label={item}
            onPress={() => setSection(item)}
            className={
              section === item
                ? "py-[9px] px-[10px] bg-recall-darkGreen rounded-[5px]"
                : "py-[9px] px-[4px]"
            }
            labelClassName={
              section === item
                ? "text-recall-surface text-[12px] font-bold"
                : "text-recall-darkGreen text-[11px] font-bold"
            }
          />
        ))}
      </View>
      {notebook && (
        <View className={section === NotebookSection.StudyMaterials ? "gap-[11px]" : "hidden"}>
          <NativeStudyMaterialsPanel
            notebook={notebook}
            searchTarget={searchTarget}
            area={area}
            api={api}
            goal={goal}
            createId={createId}
            disabled={busy || !loaded || loadFailed || !!unsaved || !mayWrite()}
            save={save}
            persistBeforeRequest={persistBeforeRequest}
            runAction={runAction}
          />
        </View>
      )}
      {unsaved ? (
        <NativeButton
          disabled={busy}
          onPress={() =>
            void runAction(async () => {
              await save(unsaved);
            })
          }
          label="Retry saving notebook"
          className={
            "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
          }
          labelClassName="text-recall-surface text-[12px] font-bold"
        />
      ) : null}
      <NativeButton
        label={showSettings ? "Close session settings" : "Session settings"}
        onPress={() => setShowSettings((current) => !current)}
        className={"py-[9px] px-[4px]"}
        labelClassName="text-recall-darkGreen text-[11px] font-bold"
      />
      {showSettings && (!notebook || notebook.session.phase !== "active") ? (
        <View className={"gap-[11px]"}>
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>Questions</Text>
          <TextInput
            accessibilityLabel="Question limit"
            keyboardType="number-pad"
            value={maxQuestions}
            onChangeText={setMaxQuestions}
            className={
              "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
          />
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>AI requests</Text>
          <TextInput
            accessibilityLabel="AI request limit"
            keyboardType="number-pad"
            value={maxRequests}
            onChangeText={setMaxRequests}
            className={
              "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
          />
          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>Minutes</Text>
          <TextInput
            accessibilityLabel="Session minutes"
            keyboardType="number-pad"
            value={durationMinutes}
            onChangeText={setDurationMinutes}
            className={
              "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
          />
        </View>
      ) : null}
      {loadFailed ? (
        <NativeButton
          disabled={busy || !mayWrite()}
          onPress={clearNotebook}
          label="Clear unreadable notebook"
          className={
            "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
          }
          labelClassName="text-recall-darkGreen text-[11px] font-bold"
        />
      ) : null}
      {!notebook && section !== NotebookSection.ReviewSuggestions ? (
        <>
          <TextInput
            accessibilityLabel="Learning goal"
            onChangeText={setGoal}
            value={goal}
            className={
              "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
            placeholder="What do you want to understand?"
          />
          <NativeButton
            disabled={busy || !loaded || loadFailed || !mayWrite()}
            onPress={() =>
              void runAction(async (isCurrent) => {
                if (isCurrent()) await start();
              })
            }
            label={section === NotebookSection.StudyMaterials ? "Start" : "Start practice"}
            className={
              "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
            }
            labelClassName="text-recall-surface text-[12px] font-bold"
          />
        </>
      ) : notebook ? (
        <>
          <View className={section === NotebookSection.Practice ? "gap-[11px]" : "hidden"}>
            <Text className={"text-recall-ink text-[14px] font-bold"}>{notebook.goal}</Text>
            {notebook.session.phase === "finished" ? (
              <View className={"gap-[7px] py-[12px] border-t border-t-recall-line"}>
                <Text className={"text-recall-ink font-bold text-[13px]"}>Practice complete</Text>
                <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
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
                    className={
                      "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
                    }
                    labelClassName="text-recall-surface text-[12px] font-bold"
                  />
                ) : null}
              </View>
            ) : null}
            {notebook.session.phase !== "active" ? (
              <NativeButton
                disabled={busy || !mayWrite()}
                onPress={() =>
                  void runAction(async (isCurrent) => {
                    if (isCurrent()) await start();
                  })
                }
                label="Continue practice"
                className={
                  "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
                }
                labelClassName="text-recall-surface text-[12px] font-bold"
              />
            ) : notebook.session.pendingQuestion ? (
              <View className={"gap-[8px] py-[12px]"}>
                {notebook.session.mode === "explain" &&
                notebook.session.pendingQuestion.explanation ? (
                  <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                    {notebook.session.pendingQuestion.explanation}
                  </Text>
                ) : null}
                <Text className={"text-recall-ink font-bold text-[13px]"}>
                  {notebook.session.pendingQuestion.question}
                </Text>
                {notebook.session.pendingQuestion.conceptSuggestions?.map((suggestion, index) => (
                  <View key={`${suggestion.title}:${index}`} className={"gap-[6px] p-[8px]"}>
                    <Text className={"text-recall-ink font-bold text-[13px]"}>
                      Suggested concept: {suggestion.title}
                    </Text>
                    <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                      {suggestion.description}
                    </Text>
                    <NativeButton
                      disabled={busy || !mayWrite()}
                      onPress={() =>
                        void runAction(async (isCurrent) => {
                          if (isCurrent()) await approveSuggestedConcept(suggestion);
                        })
                      }
                      label="Add suggested concept"
                      className={
                        "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                      }
                      labelClassName="text-recall-darkGreen text-[11px] font-bold"
                    />
                  </View>
                ))}
                <TextInput
                  accessibilityLabel="Your answer"
                  multiline
                  onChangeText={setAnswer}
                  value={answer}
                  className={
                    "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
                  }
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
                  className={
                    "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                  }
                  labelClassName="text-recall-darkGreen text-[11px] font-bold"
                />
                <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                  How sure are you?
                </Text>
                <View className={"flex-row flex-wrap gap-[7px]"}>
                  {(["guess", "unsure", "confident"] as const).map((item) => (
                    <NativeButton
                      key={item}
                      onPress={() => setConfidence(item)}
                      label={`${confidence === item ? "✓ " : ""}${item}`}
                      className={
                        "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                      }
                      labelClassName="text-recall-darkGreen text-[11px] font-bold"
                    />
                  ))}
                </View>
                <View className={"flex-row flex-wrap gap-[7px]"}>
                  <NativeButton
                    disabled={busy || !api || !mayWrite()}
                    onPress={() => void answerQuestion(answer, confidence)}
                    label="Submit answer"
                    className={
                      "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
                    }
                    labelClassName="text-recall-surface text-[12px] font-bold"
                  />
                  <NativeButton
                    disabled={busy || !api || !mayWrite()}
                    onPress={() => void answerQuestion("I don't know", "guess")}
                    label="I don't know"
                    className={
                      "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                    }
                    labelClassName="text-recall-darkGreen text-[11px] font-bold"
                  />
                </View>
                {!api ? (
                  <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                    Connect AI in settings to check your answer.
                  </Text>
                ) : null}
              </View>
            ) : (
              <View className={"gap-[8px] py-[12px]"}>
                {activeTarget && Either.isRight(activeTarget) && activeTarget.right ? (
                  <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
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
                  label="Next question"
                  className={
                    "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
                  }
                  labelClassName="text-recall-surface text-[12px] font-bold"
                />
                {!api ? (
                  <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                    Connect AI in settings to continue.
                  </Text>
                ) : null}
              </View>
            )}
            <View className={"flex-row flex-wrap gap-[7px]"}>
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
                  className={
                    "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                  }
                  labelClassName="text-recall-darkGreen text-[11px] font-bold"
                />
              ))}
            </View>
            <NativeButton
              label={showConcepts ? "Hide concepts" : "Concepts"}
              onPress={() => setShowConcepts((current) => !current)}
              className={"py-[9px] px-[4px]"}
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
            <View className={showConcepts ? "gap-[11px]" : "hidden"}>
              <View className={"flex-row flex-wrap gap-[7px]"}>
                <TextInput
                  accessibilityLabel="Add a concept"
                  onChangeText={setConceptTitle}
                  value={conceptTitle}
                  className={`${"min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"} ${"flex-1"}`}
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
                  className={
                    "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                  }
                  labelClassName="text-recall-darkGreen text-[11px] font-bold"
                />
              </View>
              <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                {notebook.session.phase === "active"
                  ? `Question ${notebook.session.askedQuestions}/${notebook.session.maxQuestions} · ${notebook.session.requestsUsed}/${notebook.session.maxRequests} tutor requests`
                  : notebook.session.phase === "finished"
                    ? "Practice finished"
                    : "Ready"}
              </Text>
              <ScrollView className={"max-h-[190px]"}>
                {notebook.concepts.map((concept) => {
                  const assessment = assessments.find((item) => item.conceptId === concept.id);
                  return (
                    <View
                      key={concept.id}
                      className={"gap-[3px] py-[7px] border-b-recall-line border-b"}
                    >
                      <NativeButton
                        label={concept.title}
                        onPress={() =>
                          setExpandedConceptId((current) =>
                            current === concept.id ? null : concept.id,
                          )
                        }
                        className={"py-[9px] px-[4px]"}
                        labelClassName="text-recall-ink text-[13px] font-bold"
                      />
                      {expandedConceptId === concept.id ? (
                        <>
                          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                            {assessment?.status ?? "unassessed"} · {assessment?.evidenceCount ?? 0}{" "}
                            evidence item(s)
                          </Text>
                          {concept.parentId ? (
                            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                              Within:{" "}
                              {notebook.concepts.find((item) => item.id === concept.parentId)
                                ?.title ?? concept.parentId}
                            </Text>
                          ) : null}
                          {concept.prerequisiteIds.length > 0 ? (
                            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                              Prerequisites:{" "}
                              {concept.prerequisiteIds
                                .map(
                                  (id) =>
                                    notebook.concepts.find((item) => item.id === id)?.title ?? id,
                                )
                                .join(", ")}
                            </Text>
                          ) : null}
                          {assessment?.reason ? (
                            <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                              {assessment.reason}
                            </Text>
                          ) : null}
                        </>
                      ) : null}
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
          <View className={section === NotebookSection.ReviewSuggestions ? "gap-[11px]" : "hidden"}>
            <NativeButton
              disabled={busy || !!unsaved || !api || !mayWrite()}
              onPress={() => void proposeBatch()}
              label="Suggest cards"
              className={
                "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
              }
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
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
                  label="Retry confirmation"
                  className={
                    "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                  }
                  labelClassName="text-recall-darkGreen text-[11px] font-bold"
                />
              ))}
          </View>
          <View className={section === NotebookSection.Practice ? "gap-[11px]" : "hidden"}>
            {latestEvidence?.kind === "tutor" ? (
              <View className={"gap-[7px] py-[12px] border-t border-t-recall-line"}>
                <Text className={"text-recall-ink font-bold text-[13px]"}>
                  Tutor feedback · {latestEvidence.evaluation.result}
                </Text>
                <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                  {latestEvidence.evaluation.feedback}
                </Text>
                {latestEvidence.evaluation.misconception ? (
                  <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                    Possible misconception: {latestEvidence.evaluation.misconception}
                  </Text>
                ) : null}
              </View>
            ) : null}
            <NativeButton
              label={showEvidence ? "Hide history" : "Answer history"}
              onPress={() => setShowEvidence((current) => !current)}
              className={"py-[9px] px-[4px]"}
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
            {showEvidence && notebook.evidence.length > 0 ? (
              <View className={"gap-[7px] py-[12px] border-t border-t-recall-line"}>
                <Text className={"text-recall-ink font-bold text-[13px]"}>
                  Recent recorded evidence
                </Text>
                {notebook.evidence
                  .slice(-10)
                  .reverse()
                  .map((entry) => (
                    <View
                      key={entry.id}
                      className={"gap-[3px] py-[7px] border-b-recall-line border-b"}
                    >
                      <Text className={"text-recall-ink font-bold text-[13px]"}>
                        {notebook.concepts.find((item) => item.id === entry.conceptId)?.title}
                      </Text>
                      {entry.kind === "tutor" ? (
                        <>
                          <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                            {entry.question}
                          </Text>
                          <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                            Your answer: {entry.answer} · {entry.learnerConfidence}
                          </Text>
                          <Text className={"text-recall-ink text-[13px] leading-[19px]"}>
                            {entry.evaluation.feedback}
                          </Text>
                        </>
                      ) : (
                        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                          Review rating: {entry.reviewEvent.rating}
                        </Text>
                      )}
                    </View>
                  ))}
              </View>
            ) : null}
          </View>
          <View className={section === NotebookSection.ReviewSuggestions ? "gap-[11px]" : "hidden"}>
            {!pendingProposal ? (
              <Text className={"text-recall-muted text-[11px] leading-[16px]"}>
                No suggestions to review.
              </Text>
            ) : null}
            {pendingProposal ? (
              <View className={"gap-[7px] py-[12px]"}>
                <Text className={"text-recall-ink font-bold text-[13px]"}>Suggested card</Text>
                {pendingProposal.sourceReferences?.length ? (
                  <NativeButton
                    label={showSources ? "Hide sources" : "Sources"}
                    onPress={() => setShowSources((current) => !current)}
                    className={"py-[9px] px-[4px]"}
                    labelClassName="text-recall-darkGreen text-[11px] font-bold"
                  />
                ) : null}
                {showSources
                  ? pendingProposal.sourceReferences?.map((reference, index) => {
                      const source = notebook.materials?.find(
                        (item) => item.id === reference.materialId,
                      );
                      const passage = source?.sections.find(
                        (item) => item.id === reference.sectionId,
                      );
                      return (
                        <View
                          key={index}
                          className={"gap-[7px] py-[12px] border-t border-t-recall-line"}
                        >
                          <Text className={"text-recall-ink font-bold text-[13px]"}>
                            Source: {source?.name} · {passage?.title}
                            {reference.pageNumber ? ` · page ${reference.pageNumber}` : ""}
                          </Text>
                          <Text selectable className={"text-recall-ink text-[13px] leading-[19px]"}>
                            {reference.quote}
                          </Text>
                          <Text
                            selectable
                            className={"text-recall-muted text-[11px] leading-[16px]"}
                          >
                            {passage?.text}
                          </Text>
                        </View>
                      );
                    })
                  : null}
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
                  className={
                    "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
                  }
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
                  className={
                    "min-h-[42px] px-[11px] py-[9px] rounded-[10px] bg-recall-paper text-recall-ink"
                  }
                />
                {proposalContent ? (
                  <NativeCardAssistancePanel
                    key={pendingProposal.id}
                    proposalOnly
                    content={proposalContent}
                    disabled={busy || !!unsaved || !mayWrite()}
                    onRefine={api ? refineProposal : undefined}
                    onInspect={api ? inspectProposal : undefined}
                    onApply={applyRefinement}
                  />
                ) : null}
                <NativeButton
                  disabled={busy || !!unsaved || !mayWrite()}
                  onPress={() =>
                    void runAction(async () => {
                      await saveProposalEdits();
                    })
                  }
                  label="Save proposal edits"
                  className={
                    "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                  }
                  labelClassName="text-recall-darkGreen text-[11px] font-bold"
                />
                <NativeProposalDuplicateWarning
                  matches={duplicateMatches}
                  acknowledged={duplicateAcknowledgement === duplicateKey}
                  disabled={busy || !!unsaved || !mayWrite()}
                  onChange={(value) => setDuplicateAcknowledgement(value ? duplicateKey : null)}
                />
                <View className={"flex-row flex-wrap gap-[7px]"}>
                  <NativeButton
                    disabled={busy || !!unsaved || !mayWrite() || !duplicatesAllowed}
                    onPress={() => void resolveProposal("accepted")}
                    label="Save & approve"
                    className={
                      "min-h-[40px] justify-center items-center px-[13px] rounded-[10px] bg-recall-darkGreen"
                    }
                    labelClassName="text-recall-surface text-[12px] font-bold"
                  />
                  <NativeButton
                    disabled={busy || !!unsaved || !mayWrite()}
                    onPress={() => void resolveProposal("discarded")}
                    label="Discard proposal"
                    className={
                      "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
                    }
                    labelClassName="text-recall-darkGreen text-[11px] font-bold"
                  />
                </View>
              </View>
            ) : null}
          </View>
          <View className={showSettings ? "gap-[11px]" : "hidden"}>
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
              label="Export notebook"
              className={
                "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
              }
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
            <NativeButton
              disabled={busy}
              onPress={clearNotebook}
              label="Clear notebook"
              className={
                "min-h-[36px] justify-center items-center px-[10px] rounded-[10px] bg-transparent"
              }
              labelClassName="text-recall-darkGreen text-[11px] font-bold"
            />
          </View>
        </>
      ) : null}
      {busy ? (
        <Text className={"text-recall-muted text-[11px] leading-[16px]"}>Saving…</Text>
      ) : null}
      {notice ? (
        <Text
          accessibilityRole="alert"
          className={"text-recall-darkGreen bg-recall-paper p-[9px] rounded-[9px] text-[12px]"}
        >
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
