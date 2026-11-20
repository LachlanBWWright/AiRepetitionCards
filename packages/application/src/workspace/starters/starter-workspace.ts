import { Effect, Schema } from "effect";
import { WorkspaceSchema, type Workspace } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";
import python1 from "./data/python-1";
import python2 from "./data/python-2";
import python3 from "./data/python-3";
import python4 from "./data/python-4";
import bicep1 from "./data/bicep-1";
import bicep2 from "./data/bicep-2";
import ooDesign from "./data/oo-design-1";

const decks = [
  {
    title: "Python",
    color: "#c4ed68",
    cards: [...python1, ...python2, ...python3, ...python4],
    author: "tltaylor1 (2026)",
    source: "https://github.com/tltaylor1/anki-decks",
  },
  {
    title: "Bicep",
    color: "#7dd3fc",
    cards: [...bicep1, ...bicep2],
    author: "tltaylor1 (2026)",
    source: "https://github.com/tltaylor1/anki-decks",
  },
  {
    title: "OO Design",
    color: "#c4b5fd",
    cards: ooDesign,
    author: "Donne Martin (2017)",
    source: "https://github.com/donnemartin/system-design-primer",
  },
] as const;

/** Only for a genuinely new workspace; never call to replace saved or deliberately empty data. */
export function createStarterWorkspace(
  now: Date,
  createId: () => string,
): Effect.Effect<Workspace, { readonly _tag: "StarterWorkspaceUnavailable" }> {
  return Effect.gen(function* () {
    const value = yield* Effect.try({
      try: () => ({
        schemaVersion: 1,
        reviews: 0,
        reviewEvents: [],
        areas: decks.map((deck) => ({
          id: createId(),
          title: deck.title,
          color: deck.color,
          sourceId: "recall-starter-v1",
          licence: "CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/",
          attribution: `${deck.author}. ${deck.source}. Converted from Anki to safe text; original styling omitted.`,
          description: `Starter deck by ${deck.author}. ${deck.source}. CC BY 4.0. Converted to safe text.`,
          cards: deck.cards.map(([sourceId, front, back]) => ({
            id: createId(),
            sourceId,
            front,
            back,
            objective: `Study ${deck.title}`,
            origin: "imported",
            schedule: newSchedule(now),
          })),
        })),
      }),
      catch: () => ({ _tag: "StarterWorkspaceUnavailable" }) as const,
    });
    return yield* Schema.decodeUnknown(WorkspaceSchema)(value).pipe(
      Effect.mapError(() => ({ _tag: "StarterWorkspaceUnavailable" }) as const),
    );
  });
}
