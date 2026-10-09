import { Effect, Schema } from "effect";
import { CardProposalSchema } from "@recall/ai-core";

export type CardAssistanceFailure = {
  readonly _tag: "CardAssistanceFailure";
  readonly message: string;
};
export type CardQualityFinding = {
  readonly kind:
    | "ambiguity"
    | "multiple-facts"
    | "answer-leakage"
    | "missing-context"
    | "unsupported-claim"
    | "other";
  readonly severity: "warning" | "suggestion";
  readonly explanation: string;
  readonly suggestion: string;
};
/** Conservative, deterministic drafting hints; these do not establish factual correctness. */
export function inspectCardQuality(
  input: unknown,
): Effect.Effect<readonly CardQualityFinding[], CardAssistanceFailure> {
  return Schema.decodeUnknown(CardProposalSchema)(input).pipe(
    Effect.mapError(
      () =>
        ({ _tag: "CardAssistanceFailure", message: "The card could not be validated." }) as const,
    ),
    Effect.map((card) => {
      const findings: CardQualityFinding[] = [];
      const add = (kind: CardQualityFinding["kind"], explanation: string, suggestion: string) =>
        findings.push({ kind, severity: "suggestion", explanation, suggestion });
      if (card.front.length > 300 || card.back.length > 600)
        add(
          "multiple-facts",
          "This card has a long question or answer; it may test several independent facts.",
          "Keep one retrieval target, and split independent facts into separate cards.",
        );
      if (
        (card.front.match(/\?/g)?.length ?? 0) > 1 ||
        /\b(list all|and explain|and describe|compare and)\b/i.test(card.front)
      )
        add(
          "multiple-facts",
          "The question appears to ask for multiple tasks.",
          "Ask one question per card, or make the required list length explicit.",
        );
      if (/\b(this|that|it|above|following)\b/i.test(card.front) && card.front.length < 100)
        add(
          "missing-context",
          "A short question refers to context that may be absent during review.",
          "Name the object or concept directly so the card can stand alone.",
        );
      if (/\b(always|never|best|better|good|bad)\b/i.test(card.front))
        add(
          "ambiguity",
          "The question uses an absolute or subjective comparison.",
          "Specify the conditions, comparison criteria, or scope.",
        );
      const answer = card.back.trim().toLowerCase();
      if (answer.length >= 8 && card.front.toLowerCase().includes(answer))
        add(
          "answer-leakage",
          "The full answer appears in the question.",
          "Remove the answer from the prompt while keeping enough context to retrieve it.",
        );
      return findings;
    }),
  );
}
