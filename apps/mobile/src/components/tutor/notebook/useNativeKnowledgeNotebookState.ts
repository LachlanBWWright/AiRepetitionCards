import { readRef } from "../../../read-ref";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Effect, Either, Schema } from "effect";
import {
  findCardDuplicates,
  knowledgeAreaDuplicateCandidates,
  proposalDuplicateCandidates,
  KnowledgeNotebookSchema,
  appendNotebookReviewEvidence,
  deriveNotebookAssessments,
  selectNotebookTarget,
  type KnowledgeNotebook,
  type NotebookAssessment,
} from "@recall/application";
import type { CardProposal } from "@recall/ai-core";
import { cardIdForTutorProposal } from "@recall/ai-core";
import {
  readNativeKnowledgeNotebook,
  writeNativeKnowledgeNotebook,
} from "../../../storage/ai/native-knowledge-notebook-store";
import { NotebookSection, failureMessage } from "./NativeKnowledgeNotebookTypes";
import type { NativeKnowledgeNotebookProps } from "./NativeKnowledgeNotebookTypes";
export function useNativeKnowledgeNotebookState(props: NativeKnowledgeNotebookProps) {
  const {
    initialActivity,
    sessionOnly = false,
    storageNamespace = "knowledge-notebook",
    area,
    searchTarget,
    duplicateCandidates = knowledgeAreaDuplicateCandidates(props.area),
    mayWrite,
    reviewEvents,
  } = props;
  const [section, setSection] = useState<NotebookSection>(
    initialActivity === "materials"
      ? NotebookSection.StudyMaterials
      : !storageNamespace.startsWith("knowledge-notebook:card-refinements")
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
  }, [area.id, storageNamespace, sessionOnly]);
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
        setExpandedConceptId(searchTarget.conceptId);
        if (searchTarget.kind === "conversation") setShowEvidence(true);
      }
    });
    return () => {
      cancelAnimationFrame(frame);
    };
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
    const isActive = () => active;
    void Effect.runPromise(
      Effect.either(
        sessionOnly ? Effect.succeed(null) : readNativeKnowledgeNotebook(area.id, storageNamespace),
      ),
    ).then((result) => {
      if (!isActive()) return;
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
  }, [area.id, storageNamespace, sessionOnly]);

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
          sessionOnly
            ? Effect.void
            : writeNativeKnowledgeNotebook(area.id, decoded.right, mayWrite, storageNamespace),
        ),
      );
      if (!readRef(mounted) || generation.current !== savedGeneration) return false;
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
    [area.id, mayWrite, storageNamespace, sessionOnly],
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

  return {
    ...props,
    initialActivity,
    storageNamespace,
    area,
    searchTarget,
    duplicateCandidates,
    mayWrite,
    reviewEvents,
    section,
    setSection,
    duplicateAcknowledgement,
    setDuplicateAcknowledgement,
    showSettings,
    setShowSettings,
    showConcepts,
    setShowConcepts,
    expandedConceptId,
    setExpandedConceptId,
    showEvidence,
    setShowEvidence,
    showSources,
    setShowSources,
    notebook,
    setNotebook,
    goal,
    setGoal,
    unsaved,
    setUnsaved,
    notebookRef,
    answer,
    setAnswer,
    confidence,
    setConfidence,
    notice,
    setNotice,
    busy,
    setBusy,
    loaded,
    setLoaded,
    loadFailed,
    setLoadFailed,
    conceptTitle,
    setConceptTitle,
    proposalDraft,
    setProposalDraft,
    mounted,
    generation,
    actionLocked,
    assessments,
    activeTarget,
    latestEvidence,
    pendingProposal,
    searchedConcept,
    searchedEvidence,
    searchedProposal,
    proposalContent,
    ownCardId,
    duplicateMatches,
    duplicateKey,
    duplicatesAllowed,
    save,
    runAction,
  } as const;
}
export type NativeNotebookState = ReturnType<typeof useNativeKnowledgeNotebookState>;
