import { Effect, Schema } from "effect";
import { createObjectiveId } from "@recall/domain";
import type { KnowledgeArea, ReviewEvent } from "@recall/domain";
import type { createTutorApi } from "../transport/tutor-api";
import { TutorActionResponseSchema, selectTutorContextHistory } from "@recall/ai-core";
import { tutorApiFailureMessage } from "../transport/tutor-api";
import {
  seedKnowledgeNotebook,
  beginNotebookSession,
  reserveNotebookRequest,
  addNotebookProposal,
  addNotebookConcepts,
  appendNotebookReviewEvidence,
} from "../../notebook/knowledge-notebook";
import type { KnowledgeNotebook } from "../../notebook/knowledge-notebook";

export type ImprovementMessage = {
  readonly id: string;
  readonly role: "learner" | "assistant";
  readonly content: string;
  readonly at: number;
};
export function improvementMessages(
  notebook: KnowledgeNotebook | null,
): readonly ImprovementMessage[] {
  return notebook?.improvementChat ?? [];
}
export function improvementOpening(area: KnowledgeArea): string {
  const topic = area.objectives[0]?.title;
  return topic
    ? `Your deck covers ${topic}. What experience do you have with this, and where do you get stuck?`
    : `What's your experience with ${area.title} so far? Tell me something you've tried or a part you find confusing.`;
}

type Failure = { readonly message: string; readonly notebook?: KnowledgeNotebook | null };
export function sendImprovementMessage(
  input: {
    readonly notebook: KnowledgeNotebook | null;
    readonly area: KnowledgeArea;
    readonly reviews: readonly ReviewEvent[];
    readonly message: string;
  },
  dependencies: {
    readonly api: ReturnType<typeof createTutorApi>;
    readonly save: (notebook: KnowledgeNotebook) => Effect.Effect<KnowledgeNotebook, Failure>;
    readonly now: () => number;
    readonly createId: () => string;
  },
) {
  return Effect.gen(function* () {
    const message = yield* Schema.decodeUnknown(
      Schema.String.pipe(Schema.minLength(1), Schema.maxLength(input.notebook ? 8000 : 2000)),
    )(input.message.trim()).pipe(
      Effect.mapError(() => ({ message: "Write a message within the field limit." })),
    );
    let notebook =
      input.notebook ??
      (yield* seedKnowledgeNotebook(
        input.area,
        `Explore experience and gaps in ${input.area.title}`.slice(0, 2000),
      ));
    const history = improvementMessages(input.notebook);
    const append = (
      current: KnowledgeNotebook,
      role: ImprovementMessage["role"],
      content: string,
    ) => ({
      ...current,
      improvementChat: [
        ...(current.improvementChat ?? history),
        { id: dependencies.createId(), role, content, at: dependencies.now() },
      ],
    });
    if (history.length === 0)
      notebook = append(notebook, "assistant", improvementOpening(input.area));
    const last = history.at(-1);
    if (last?.role !== "learner" || last.content !== message)
      notebook = append(notebook, "learner", message);
    notebook = yield* dependencies.save(notebook);
    if (notebook.session.phase !== "active") {
      notebook = yield* beginNotebookSession(notebook, { startedAt: dependencies.now() });
      notebook = yield* appendNotebookReviewEvidence(notebook, input.area, input.reviews);
    }
    // An older investigation can have a pending quiz. Preserve it in the transcript,
    // but never treat the next chat message as an answer to be graded.
    notebook = {
      ...notebook,
      session: { ...notebook.session, pendingQuestion: null, draftAnswer: "" },
    };
    notebook = yield* reserveNotebookRequest(notebook, dependencies.now(), "question");
    notebook = yield* dependencies.save(notebook);
    const raw = yield* dependencies.api
      .request({
        action: "question",
        context: {
          knowledgeArea: input.area,
          history: selectTutorContextHistory(
            improvementMessages(notebook).map(({ role, content }) => ({
              role,
              content: content.slice(0, 8000),
            })),
            true,
          ),
          ephemeralSession: true,
          improvement: {
            goal: `${notebook.goal}
Recent self-rated reviews: ${
              input.reviews
                .filter((event) => event.areaId === input.area.id)
                .slice(-8)
                .map((event) => `${event.cardId}: ${event.rating}`)
                .join(", ") || "none"
            }`.slice(0, 2000),
          },
        },
      })
      .pipe(Effect.mapError((error) => ({ message: tutorApiFailureMessage(error), notebook })));
    const response = yield* Schema.decodeUnknown(TutorActionResponseSchema)(raw).pipe(
      Effect.mapError(() => ({ message: "The chat response could not be validated.", notebook })),
    );
    if (response.action !== "question")
      return yield* Effect.fail({
        message: "The AI returned a different task instead of a chat reply.",
        notebook,
      });
    const proposal = response.result.proposal;
    if (proposal) {
      if (!response.proposalId)
        return yield* Effect.fail({
          message:
            "The AI service returned a card without a proposal ID. Your conversation is preserved.",
          notebook,
        });
      let concept = notebook.concepts.find((item) => item.objectiveId === proposal.objectiveId);
      if (!concept) {
        const objective = input.area.objectives.find((item) => item.id === proposal.objectiveId);
        if (proposal.objectiveId !== null && !objective)
          return yield* Effect.fail({
            message: "The proposed card refers to an unknown learning objective.",
            notebook,
          });
        const id = createObjectiveId(dependencies.createId());
        notebook = yield* addNotebookConcepts(notebook, [
          {
            id,
            title: objective?.title ?? input.area.title,
            description: objective?.description ?? null,
            objectiveId: proposal.objectiveId,
            parentId: null,
            prerequisiteIds: [],
          },
        ]);
        concept = notebook.concepts.find((item) => item.id === id);
      }
      if (!concept)
        return yield* Effect.fail({
          message: "The proposed card concept could not be saved.",
          notebook,
        });
      notebook = yield* addNotebookProposal(
        notebook,
        {
          id: response.proposalId,
          conceptId: concept.id,
          evidenceIds: [],
          chatMessageId: improvementMessages(notebook).at(-1)?.id,
          proposal,
          createdAt: dependencies.now(),
          providerSessionId: response.sessionId,
          providerResolutionRequired: response.providerResolutionRequired ?? true,
        },
        input.area.cards,
      ).pipe(Effect.mapError((error) => ({ message: error.message, notebook })));
    }
    const reply = [response.result.explanation, response.result.question]
      .filter(Boolean)
      .join("\n\n");
    notebook = append(notebook, "assistant", reply);
    return yield* dependencies.save(notebook);
  });
}
