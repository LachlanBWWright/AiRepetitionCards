import type { Workspace } from "./types";
import { Schema } from "effect";
import { WorkspaceSchema } from "@recall/domain";
import { newSchedule } from "@recall/scheduler";

const today = new Date("2020-10-03T09:00:00.000Z");
const nextWeek = new Date("2099-10-10T09:00:00.000Z");

const mockWorkspaceValue = {
  schemaVersion: 1,
  reviews: 12,
  reviewEvents: Array.from({ length: 12 }, (_, index) => ({
    id: `mock-review-${index + 1}`,
    areaId: "area-biology",
    cardId: `bio-${(index % 2) + 1}`,
    ratedAt: "2026-10-02T09:00:00.000Z",
    rating: index % 4 === 0 ? ("hard" as const) : ("good" as const),
    schedulerFamily: "fsrs" as const,
    schedulerVersion: "ts-fsrs@5.4.2",
  })),
  areas: [
    {
      id: "area-biology",
      title: "Cell biology",
      color: "#c4ed68",
      cards: [
        {
          id: "bio-1",
          front: "What is the main role of mitochondria?",
          back: "They produce most of the cell’s usable ATP through cellular respiration.",
          objective: "Cell structures",
          schedule: newSchedule(today),
        },
        {
          id: "bio-2",
          front: "Where does transcription happen in a eukaryotic cell?",
          back: "In the nucleus, where DNA is used to make RNA.",
          objective: "Gene expression",
          schedule: newSchedule(today),
        },
        {
          id: "bio-3",
          front: "What does the cell membrane regulate?",
          back: "The movement of substances into and out of the cell.",
          objective: "Cell structures",
          schedule: newSchedule(nextWeek),
        },
        {
          id: "bio-4",
          front: "Which organelle modifies and packages proteins?",
          back: "The Golgi apparatus.",
          objective: "Cell structures",
          schedule: newSchedule(nextWeek),
        },
      ],
    },
    {
      id: "area-spanish",
      title: "Spanish · essentials",
      color: "#ffb29b",
      cards: [
        {
          id: "es-1",
          front: "How do you say ‘I would like’ politely?",
          back: "Quisiera… (for example, ‘Quisiera un café.’)",
          objective: "Useful phrases",
          schedule: newSchedule(today),
        },
        {
          id: "es-2",
          front: "What is the difference between ser and estar?",
          back: "Ser describes identity or lasting traits; estar describes states and locations.",
          objective: "Core grammar",
          schedule: newSchedule(nextWeek),
        },
      ],
    },
    {
      id: "area-math",
      title: "Linear algebra",
      color: "#c4b5fd",
      cards: [
        {
          id: "math-1",
          front: "What does an eigenvector represent?",
          back: "A non-zero vector whose direction is unchanged by a linear transformation; it is only scaled.",
          objective: "Eigenvalues",
          schedule: newSchedule(nextWeek),
        },
      ],
    },
  ],
};

export const mockWorkspace: Workspace =
  Schema.decodeUnknownSync(WorkspaceSchema)(mockWorkspaceValue);

const caughtUpWorkspaceValue = {
  schemaVersion: 1,
  reviews: 24,
  reviewEvents:
    mockWorkspace.reviewEvents?.map((event) => ({ ...event, id: `caught-up-${event.id}` })) ?? [],
  areas: mockWorkspace.areas.map((area) => ({
    ...area,
    cards: area.cards.map((card) => ({ ...card, schedule: newSchedule(nextWeek) })),
  })),
};

export const caughtUpWorkspace: Workspace =
  Schema.decodeUnknownSync(WorkspaceSchema)(caughtUpWorkspaceValue);

const emptyWorkspaceValue = {
  schemaVersion: 1,
  reviews: 0,
  reviewEvents: [],
  areas: [],
};

export const emptyWorkspace: Workspace =
  Schema.decodeUnknownSync(WorkspaceSchema)(emptyWorkspaceValue);
