import { Effect, Either, Schema } from "effect";
import { KnowledgeAreaSchema } from "@recall/domain";
import { CodingPayloadSchema } from "@recall/domain";
import { builtinActivityRegistry } from "../activities/learning-activities";

export type DeckQualityIssue = {
  readonly code:
    | "duplicate-card"
    | "invalid-media-reference"
    | "unavailable-media-bytes"
    | "missing-objective"
    | "ambiguous-choice"
    | "invalid-correct-answer"
    | "insufficient-tests"
    | "duplicate-test"
    | "unknown-activity-plugin"
    | "invalid-activity-payload"
    | "invalid-deck";
  readonly severity: "blocking" | "warning";
  readonly message: string;
  readonly cardId?: string;
  readonly activityId?: string;
};
export type DeckQualityFailure = {
  readonly _tag: "DeckQualityFailure";
  readonly message: string;
};
export type DeckQualityOptions = {
  /** Media IDs whose bytes are currently available. Omit when byte availability has not been checked. */
  readonly availableMediaIds?: readonly string[];
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
const normalized = (value: string): string => value.trim().replace(/\s+/g, " ").toLowerCase();
const issueLimit = 50;
const mediaMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);
const validMediaReference = (entry: Record<string, unknown> | undefined): boolean =>
  !!entry &&
  typeof entry.id === "string" &&
  /^[a-f0-9]{64}$/.test(entry.id) &&
  typeof entry.mimeType === "string" &&
  mediaMimeTypes.has(entry.mimeType) &&
  typeof entry.byteLength === "number" &&
  Number.isInteger(entry.byteLength) &&
  entry.byteLength > 0 &&
  entry.byteLength <= 20_000_000;

/** Conservative publishing checks. These findings describe content quality and never infer mastery. */
export function inspectDeckQuality(
  input: unknown,
  options: DeckQualityOptions = {},
): Effect.Effect<readonly DeckQualityIssue[], DeckQualityFailure> {
  return Effect.gen(function* () {
    const raw = record(input);
    if (!raw || !Array.isArray(raw.cards) || raw.cards.length > 500)
      return yield* Effect.fail({
        _tag: "DeckQualityFailure",
        message: "The deck could not be validated for publishing.",
      } as const);

    const findings: DeckQualityIssue[] = [];
    const add = (issue: DeckQualityIssue) => {
      if (findings.length < issueLimit) {
        findings.push(issue);
      } else if (issue.severity === "blocking") {
        let warningIndex = -1;
        for (let index = findings.length - 1; index >= 0; index -= 1) {
          if (findings[index]?.severity === "warning") {
            warningIndex = index;
            break;
          }
        }
        if (warningIndex >= 0) findings[warningIndex] = issue;
      }
    };
    // Keep validation at the boundary while allowing a malformed media reference to be reported
    // specifically instead of hiding it behind the enclosing deck schema error.
    const cards: readonly unknown[] = raw.cards;
    for (const [index, candidate] of cards.entries()) {
      const card = record(candidate);
      if (!card) continue;
      const cardId = text(card.id);
      const media = Array.isArray(card.media) ? card.media : [];
      media.forEach((reference) => {
        const entry = record(reference);
        if (!validMediaReference(entry)) {
          add({
            code: "invalid-media-reference",
            severity: "blocking",
            message: `Card ${String(index + 1)} has an invalid media reference.`,
            ...(cardId ? { cardId } : {}),
          });
        } else if (
          options.availableMediaIds &&
          !options.availableMediaIds.includes(String(entry?.id))
        ) {
          add({
            code: "unavailable-media-bytes",
            severity: "blocking",
            message: `Media bytes for card ${String(index + 1)} are unavailable.`,
            ...(cardId ? { cardId } : {}),
          });
        }
      });
    }
    // Invalid media records are stripped only for the structural decode; all other schema
    // validation remains strict and the invalid reference has already been surfaced above.
    const sanitized = {
      ...raw,
      cards: cards.map((candidate) => {
        const card = record(candidate);
        if (!card || !Array.isArray(card.media)) return candidate;
        return {
          ...card,
          media: card.media.filter((reference) => {
            const entry = record(reference);
            return validMediaReference(entry);
          }),
        };
      }),
    };
    const decoded = yield* Schema.decodeUnknown(KnowledgeAreaSchema)(sanitized).pipe(
      Effect.mapError(
        () =>
          ({
            _tag: "DeckQualityFailure",
            message: "The deck could not be validated for publishing.",
          }) as const,
      ),
    );
    const objectiveIds = new Set(decoded.objectives.map((objective) => objective.id));
    const cardKeys = new Map<string, string>();
    for (const card of decoded.cards) {
      const cardId = card.id;
      const key =
        card.kind === "basic"
          ? `${normalized(card.front)}\u0000${normalized(card.back)}`
          : normalized(card.text);
      if (cardKeys.has(key))
        add({
          code: "duplicate-card",
          severity: "warning",
          message: "This card duplicates another card in the deck.",
          cardId,
        });
      else cardKeys.set(key, cardId);
      if (card.objectiveIds.length === 0 || card.objectiveIds.some((id) => !objectiveIds.has(id)))
        add({
          code: "missing-objective",
          severity: "warning",
          message: "This card has no valid learning objective assigned.",
          cardId,
        });
    }
    for (const activity of decoded.activities ?? []) {
      const plugin = builtinActivityRegistry.find(
        (candidate) => candidate.id === activity.pluginId,
      );
      if (!plugin || plugin.version !== activity.pluginVersion)
        add({
          code: "unknown-activity-plugin",
          severity: "warning",
          message:
            "This activity uses a plugin that may not be available to everyone who receives the deck.",
          activityId: activity.id,
        });
      if (plugin) {
        const validation = yield* Effect.either(plugin.present(activity.payload));
        if (Either.isLeft(validation))
          add({
            code: "invalid-activity-payload",
            severity: "blocking",
            message:
              "This activity payload does not match its built-in activity type and needs repair before publishing.",
            activityId: activity.id,
          });
      }
      if (activity.pluginId === "recall.multiple-choice") {
        const payload = record(activity.payload);
        const optionsList = payload && Array.isArray(payload.options) ? payload.options : [];
        const choices = optionsList.map(record);
        const choiceTexts = choices
          .map((choice) => (choice ? text(choice.text) : undefined))
          .filter((value): value is string => !!value);
        if (
          optionsList.length < 2 ||
          choices.some((choice) => !choice || !text(choice.text) || !text(choice.id)) ||
          new Set(choices.map((choice) => choice?.id)).size !== choices.length ||
          new Set(choiceTexts.map(normalized)).size !== choiceTexts.length
        )
          add({
            code: "ambiguous-choice",
            severity: "warning",
            message: "This multiple-choice activity has repeated or indistinguishable choices.",
            activityId: activity.id,
          });
        const correct = payload?.correctOptionIds;
        if (
          !Array.isArray(correct) ||
          correct.length === 0 ||
          correct.some(
            (id) => typeof id !== "string" || !choices.some((choice) => choice?.id === id),
          )
        )
          add({
            code: "invalid-correct-answer",
            severity: "blocking",
            message: "This multiple-choice activity does not identify a valid correct answer.",
            activityId: activity.id,
          });
      }
      if (activity.pluginId === "recall.coding") {
        const result = Schema.decodeUnknownEither(CodingPayloadSchema)(activity.payload);
        if (result._tag === "Right") {
          const tests = result.right.tests;
          const keys = tests.map((test) => JSON.stringify([test.input, test.expected]));
          if (tests.length < 2)
            add({
              code: "insufficient-tests",
              severity: "warning",
              message: "Add at least two tests so the coding activity checks more than one case.",
              activityId: activity.id,
            });
          if (new Set(keys).size !== keys.length)
            add({
              code: "duplicate-test",
              severity: "warning",
              message: "This coding activity contains duplicate tests.",
              activityId: activity.id,
            });
        }
      }
    }
    return findings;
  });
}
