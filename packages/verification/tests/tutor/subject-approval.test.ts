import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either } from "effect";
import { createTutorApi, type KnowledgeNotebook } from "@recall/application";
import { createKnowledgeNotebookProposalActions } from "../../../../apps/web/src/components/tutor/notebook/proposals/KnowledgeNotebookProposalActions";
import { searchFixture, knowledgeArea, uuid } from "../fixtures/search-workspace";
function approvalFixture(failAt: number | null = null) {
  const fixture = searchFixture().notebook;
  const proposal = fixture.proposals[0];
  assert.ok(proposal);
  const notebook: KnowledgeNotebook = {
    ...fixture,
    proposals: [1, 2, 3].map((number) => ({
      ...proposal,
      id: uuid(20 + number),
      providerSessionId: uuid(30 + number),
      providerResolutionRequired: true,
      proposal: {
        ...proposal.proposal,
        front: `Question ${String(number)}`,
        back: `Answer ${String(number)}`,
      },
    })),
  };
  const current = { current: notebook };
  const approved: string[] = [];
  let completion: Promise<Either.Either<KnowledgeNotebook, unknown>> = Promise.resolve(
    Either.left("Not started"),
  );
  const actions = createKnowledgeNotebookProposalActions({
    current,
    alive: { current: 0 },
    drafts: {},
    demo: true,
    knowledgeArea: knowledgeArea(),
    api: createTutorApi(() => Effect.succeed({ status: 503, body: null })),
    setDrafts: () => undefined,
    save: (next) => {
      current.current = next;
      return Effect.succeed(next);
    },
    run: (operation) => {
      completion = Effect.runPromise(Effect.either(operation));
    },
    proposalDuplicates: () => ({ matches: [], key: "", acknowledged: true }),
    onApprove: (content, _cardId, proposalId) => {
      approved.push(proposalId);
      return Promise.resolve(approved.length === failAt ? null : content);
    },
  });
  return { actions, current, approved, finish: () => completion };
}
void test("batch approval accepts only explicitly selected proposals and retains every earlier acceptance", async () => {
  const fixture = approvalFixture();
  fixture.actions.approveSelected([uuid(21), uuid(23)]);
  const result = await fixture.finish();
  assert.ok(Either.isRight(result), JSON.stringify(result));
  assert.deepEqual(fixture.approved, [uuid(21), uuid(23)]);
  assert.deepEqual(
    fixture.current.current.proposals.map((entry) => entry.status),
    ["accepted", "pending", "accepted"],
  );
});
void test("batch approval stops on a failed save and leaves remaining proposals pending", async () => {
  const fixture = approvalFixture(2);
  fixture.actions.approveSelected([uuid(21), uuid(22), uuid(23)]);
  await fixture.finish();
  assert.deepEqual(fixture.approved, [uuid(21), uuid(22)]);
  assert.deepEqual(
    fixture.current.current.proposals.map((entry) => entry.status),
    ["accepted", "pending", "pending"],
  );
});
