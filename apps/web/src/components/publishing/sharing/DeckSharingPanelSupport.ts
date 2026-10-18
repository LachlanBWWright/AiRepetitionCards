import { Effect } from "effect";
import { builtinActivityRegistry } from "@recall/application";
import type { DeckSummary } from "@recall/contracts";

export const runDeckSharingEffect = <A>(effect: Effect.Effect<A, unknown>) =>
  Effect.runPromise(Effect.either(effect));

export const decodeDeckSharingDifficulty = (
  value: string,
): "" | "beginner" | "intermediate" | "advanced" =>
  value === "beginner" || value === "intermediate" || value === "advanced" ? value : "";

export const deckSharingActivityLabel = (type: string): string =>
  type === "basic"
    ? "Basic flashcards"
    : type === "cloze"
      ? "Cloze cards"
      : (builtinActivityRegistry.find((plugin) => plugin.id === type)?.label ?? type);

export const deckSharingActivityTypes = (
  decks: readonly DeckSummary[],
  selectedType: string,
): readonly string[] =>
  [
    ...new Set([
      ...builtinActivityRegistry.map((plugin) => plugin.id),
      ...decks.flatMap((deck) => [
        ...(deck.catalog?.activityTypes ?? []),
        ...(deck.catalog?.cardTypes ?? []),
      ]),
      ...(selectedType ? [selectedType] : []),
    ]),
  ].sort();

export const deckSharingDifficultyLabel = (difficulty: string | null | undefined): string =>
  difficulty ? `${difficulty} · ` : "Difficulty unspecified · ";

export const deckSharingErrorMessage = (error: unknown): string => {
  if (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status === 401
      ? "Sign in to use this feature."
      : `The request failed (${String(error.status)}). Please try again.`;
  }
  return "The response could not be loaded. Check your connection and try again.";
};
