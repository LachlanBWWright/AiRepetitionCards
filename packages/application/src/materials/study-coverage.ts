import { Effect, Schema } from "effect";
import {
  KnowledgeNotebookSchema,
  StudyCoveragePlanSchema,
  type NotebookFailure,
} from "../notebook/knowledge-notebook";
const failure = (message: string): NotebookFailure => ({
  _tag: "NotebookFailure",
  reason: "invalid-input",
  message,
});
const read = (input: unknown) =>
  Schema.decodeUnknown(KnowledgeNotebookSchema)(input).pipe(
    Effect.mapError(() => failure("The saved notebook or source-backed coverage plan is invalid.")),
  );
function deriveClaimCoverage(
  plan: NonNullable<
    import("../notebook/knowledge-notebook").KnowledgeNotebook["coveragePlans"]
  >[number],
  claim: NonNullable<
    import("../notebook/knowledge-notebook").KnowledgeNotebook["coveragePlans"]
  >[number]["claims"][number],
  proposals: import("../notebook/knowledge-notebook").KnowledgeNotebook["proposals"],
) {
  const cards = proposals.filter((proposal) => proposal.claimId === claim.id);
  const pendingCards = cards.filter((card) => card.status === "pending").length;
  const approvedCards = cards.filter((card) => card.status === "accepted").length;
  const status =
    claim.decision === "skipped"
      ? "skipped"
      : claim.decision === "pending"
        ? "pending"
        : approvedCards > 0
          ? "covered"
          : pendingCards > 0
            ? "proposed"
            : "uncovered";
  return {
    ...claim,
    planId: plan.id,
    claimId: claim.id,
    materialId: plan.materialId,
    sectionId: plan.sectionId,
    status,
    pendingCards,
    approvedCards,
  };
}
function updateClaimDecision(
  claim: NonNullable<
    import("../notebook/knowledge-notebook").KnowledgeNotebook["coveragePlans"]
  >[number]["claims"][number],
  claimId: string,
  decision: "pending" | "selected" | "skipped",
  priority: "high" | "medium" | "low",
) {
  return claim.id === claimId ? { ...claim, decision, priority } : claim;
}
export function addStudyCoveragePlan(notebookInput: unknown, planInput: unknown) {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const plan = yield* Schema.decodeUnknown(StudyCoveragePlanSchema)(planInput).pipe(
      Effect.mapError(() => failure("The coverage plan could not be validated.")),
    );
    if (notebook.coveragePlans?.some((item) => item.id === plan.id))
      return yield* Effect.fail(failure("This coverage plan already exists."));
    return yield* read({ ...notebook, coveragePlans: [...(notebook.coveragePlans ?? []), plan] });
  });
}
export function updateStudyCoverageClaim(notebookInput: unknown, input: unknown) {
  return Effect.gen(function* () {
    const notebook = yield* read(notebookInput);
    const value = yield* Schema.decodeUnknown(
      Schema.Struct({
        planId: Schema.UUID,
        claimId: Schema.UUID,
        decision: Schema.Literal("pending", "selected", "skipped"),
        priority: Schema.Literal("high", "medium", "low"),
      }),
    )(input).pipe(Effect.mapError(() => failure("Select a valid claim, priority and decision.")));
    const plan = notebook.coveragePlans?.find((item) => item.id === value.planId);
    if (!plan?.claims.some((claim) => claim.id === value.claimId))
      return yield* Effect.fail(failure("This claim is no longer available."));
    return yield* read({
      ...notebook,
      coveragePlans: notebook.coveragePlans?.map((item) =>
        item.id !== plan.id
          ? item
          : {
              ...item,
              claims: item.claims.map((claim) =>
                updateClaimDecision(claim, value.claimId, value.decision, value.priority),
              ),
            },
      ),
    });
  });
}
export function deriveStudyClaimCoverage(notebookInput: unknown) {
  return read(notebookInput).pipe(
    Effect.map((notebook) =>
      (notebook.coveragePlans ?? []).flatMap((plan) =>
        plan.claims.map((claim) => deriveClaimCoverage(plan, claim, notebook.proposals)),
      ),
    ),
  );
}
