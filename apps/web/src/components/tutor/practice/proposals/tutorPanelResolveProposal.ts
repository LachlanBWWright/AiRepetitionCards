import { Effect, Either, Schema } from "effect";
import { CardProposalSchema, cardIdForTutorProposal } from "@recall/ai-core";
import { tutorApiFailureMessage } from "@recall/application";
import type { TutorPanel } from "../TutorPanel";
import type { useTutorPanelSession } from "../useTutorPanelSession";
type Dependencies = Pick<
  ReturnType<typeof useTutorPanelSession>,
  | "proposalId"
  | "proposal"
  | "sessionId"
  | "duplicatesAllowed"
  | "setMessage"
  | "approvalEpoch"
  | "proposalKey"
  | "setBusy"
  | "savedApproval"
  | "setSavedApproval"
  | "setProposal"
  | "setProposalId"
  | "setEvaluation"
> &
  Pick<Parameters<typeof TutorPanel>[0], "knowledgeArea" | "onApprove"> & {
    readonly demo: boolean;
    readonly api: typeof import("@/lib/tutor-api").tutorApi;
  };
export function resolveTutorPanelProposal(
  state: "approved" | "rejected",
  dependencies: Dependencies,
) {
  const {
    proposalId,
    proposal,
    sessionId,
    duplicatesAllowed,
    setMessage,
    approvalEpoch,
    proposalKey,
    setBusy,
    savedApproval,
    setSavedApproval,
    setProposal,
    setProposalId,
    setEvaluation,
    demo,
    api,
    knowledgeArea,
    onApprove,
  } = dependencies;

  if (!proposalId || !proposal || !sessionId) return;
  if (state === "approved" && !duplicatesAllowed) {
    setMessage("Review the possible duplicates and choose Keep both before saving.");
    return;
  }
  const cardId = demo ? "7f07f0d6-6912-48c4-b31b-61a0dbe514ac" : cardIdForTutorProposal(proposalId);
  if (!cardId) {
    setMessage("This proposal has an invalid identifier and cannot be approved.");
    return;
  }
  const decoded = Schema.decodeUnknownEither(CardProposalSchema)({
    ...proposal,
    front: proposal.front.trim(),
    back: proposal.back.trim(),
    rationale: proposal.rationale.trim(),
  });
  if (
    state === "approved" &&
    (Either.isLeft(decoded) ||
      (decoded.right.objectiveId !== null &&
        !knowledgeArea.objectives.some((objective) => objective.id === decoded.right.objectiveId)))
  ) {
    setMessage(
      "Write a question, answer and rationale within the field limits, and choose an objective from this area.",
    );
    return;
  }
  const approvedProposal = Either.isRight(decoded) ? decoded.right : proposal;
  const epoch = approvalEpoch.current;
  const key = proposalKey;
  if (!key) return;
  const currentApproval = () => approvalEpoch.current === epoch;
  setBusy(true);
  setMessage(null);
  const program = Effect.gen(function* () {
    let savedProposal = approvedProposal;
    if (state === "approved") {
      const saved =
        savedApproval?.key === key
          ? savedApproval.content
          : yield* Effect.tryPromise({
              try: () => onApprove(approvedProposal, cardId, proposalId, sessionId),
              catch: () => ({ _tag: "TutorLocalApprovalFailed" }) as const,
            });
      if (!currentApproval()) return yield* Effect.fail({ _tag: "TutorApprovalStale" } as const);
      if (!saved) return yield* Effect.fail({ _tag: "TutorLocalApprovalFailed" } as const);
      savedProposal = saved;
      setSavedApproval({ key, content: saved });
      setProposal(saved);
      if (
        saved.front !== approvedProposal.front ||
        saved.back !== approvedProposal.back ||
        saved.objectiveId !== approvedProposal.objectiveId ||
        saved.rationale !== approvedProposal.rationale
      )
        return yield* Effect.fail({ _tag: "TutorSavedContentRestored" } as const);
    }
    if (demo) return;
    return yield* api.resolveProposal({
      proposalId,
      state,
      ...(state === "approved" ? { content: savedProposal, cardId } : {}),
    });
  }).pipe(
    Effect.match({
      onFailure: (error) => {
        if (!currentApproval()) return;
        setMessage(
          error._tag === "TutorSavedContentRestored"
            ? "This proposal already has a saved card. Its durable content has been restored without overwriting it. Retry approval to confirm that saved card."
            : error._tag === "TutorLocalApprovalFailed"
              ? "The card could not be saved locally. Your proposal and edits are still available to retry."
              : error._tag === "TutorApiFailure" || error._tag === "TutorTransportError"
                ? tutorApiFailureMessage(error)
                : "This proposal could not be saved yet. Try again.",
        );
      },
      onSuccess: () => {
        if (!currentApproval()) return;
        setProposal(null);
        setProposalId(null);
        setEvaluation(null);
      },
    }),
    Effect.ensuring(
      Effect.sync(() => {
        if (currentApproval()) setBusy(false);
      }),
    ),
  );
  Effect.runFork(program);
}
