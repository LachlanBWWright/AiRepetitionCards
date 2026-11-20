import { Schema } from "effect";

const Id = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(200));
const Text = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(20_000));
const Title = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80));
const Color = Schema.String.pipe(Schema.pattern(/^#[0-9a-fA-F]{6}$/));
const Card = {
  front: Text,
  back: Text,
  explanation: Schema.String.pipe(Schema.maxLength(10_000)),
  tags: Schema.Array(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(80))).pipe(
    Schema.maxItems(100),
  ),
};
export const AgentOperationSchema = Schema.Union(
  Schema.Struct({ op: Schema.Literal("create-deck"), key: Id, title: Title, color: Color }),
  Schema.Struct({ op: Schema.Literal("update-deck"), deckId: Id, title: Title, color: Color }),
  Schema.Struct({ op: Schema.Literal("delete-deck"), deckId: Id }),
  Schema.Struct({ op: Schema.Literal("create-card"), key: Id, deckId: Id, ...Card }),
  Schema.Struct({ op: Schema.Literal("update-card"), deckId: Id, cardId: Id, ...Card }),
  Schema.Struct({ op: Schema.Literal("delete-card"), deckId: Id, cardId: Id }),
);
export const AgentProposalSchema = Schema.Struct({
  format: Schema.Literal("recall-agent-changes"),
  version: Schema.Literal(1),
  handoverId: Id,
  decks: Schema.Array(Schema.Struct({ id: Id, revision: Id })).pipe(Schema.maxItems(100)),
  operations: Schema.Array(AgentOperationSchema).pipe(Schema.minItems(1), Schema.maxItems(100)),
});
export const ApplyAgentChangesSchema = Schema.Struct({
  kind: Schema.Literal("apply-agent-changes"),
  proposal: AgentProposalSchema,
});
export type AgentProposal = typeof AgentProposalSchema.Type;
export type AgentOperation = typeof AgentOperationSchema.Type;
export type AgentFailure = { readonly message: string };
export const MAX_AGENT_JSON_BYTES = 2_000_000;
export const AGENT_TASKS = [
  {
    value: "improve",
    label: "Improve this deck",
    prompt:
      "Find gaps, ambiguity, duplicates and overloaded cards. Discuss focused improvements before proposing changes.",
  },
  {
    value: "mistake",
    label: "Explain an error or mistake",
    prompt:
      "Explain the supplied error message, code failure or mistaken answer. Ask for relevant missing code, error text or learner answer instead of guessing. Explain the cause and a concrete correction, distinguish a misunderstanding from a card defect, and suggest a clearer card only when useful. Never invent the learner's answer or claim to have executed code.",
  },
  {
    value: "teach",
    label: "Teach this topic",
    prompt:
      "Explain the requested concept using the deck's terminology. Answer follow-ups and check understanding. Ask what to focus on if unclear.",
  },
  {
    value: "quiz",
    label: "Quiz me",
    prompt:
      "Ask one retrieval or transfer question at a time. Withhold answers until the learner attempts it, then explain mistakes. Do not manufacture review records or mastery.",
  },
  {
    value: "accuracy",
    label: "Check accuracy",
    prompt:
      "Check claims for accuracy. Distinguish verified corrections from uncertainty, cite sources you actually consulted, and never claim research you did not perform.",
  },
  {
    value: "custom",
    label: "Custom request",
    prompt:
      "Help with the learner's stated goal. Ask a focused clarification if the goal is unclear.",
  },
] as const;
export type AgentTask = (typeof AGENT_TASKS)[number]["value"];
