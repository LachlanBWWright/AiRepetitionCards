import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import RecallDashboard from "../features/dashboard/RecallDashboard";
import { DashboardView } from "../features/dashboard/dashboard-navigation";
import { createObjectiveId, createReviewEventId } from "@recall/domain";
import { caughtUpWorkspace, emptyWorkspace, mockWorkspace } from "../features/workspace/mock-data";
import {
  deletedCardPendingWorkspace,
  deletedAreaPendingWorkspace,
  legacyMissingReviewContentWorkspace,
} from "../features/workspace/deleted-review-mock-data";

const firstReviewId = mockWorkspace.reviewEvents?.[0]?.id;
const seedReview = mockWorkspace.reviewEvents?.[0];
const practiceWorkspace = {
  ...mockWorkspace,
  reviews: 18,
  reviewEvents: [
    ...(mockWorkspace.reviewEvents ?? []),
    ...(seedReview
      ? (["again", "hard", "good", "easy"] as const).map((rating, index) => ({
          ...seedReview,
          id: createReviewEventId(`practice-today-${String(index)}`),
          ratedAt: "2026-10-03T05:00:00.000Z",
          rating,
        }))
      : []),
    ...(seedReview
      ? [0, 1].map((index) => ({
          ...seedReview,
          id: createReviewEventId(`practice-older-${String(index)}`),
          ratedAt: "2026-09-20T05:00:00.000Z",
        }))
      : []),
  ],
};
const reviewConflictWorkspace = {
  ...mockWorkspace,
  reviewConflictIds: firstReviewId ? [firstReviewId] : [],
};
const cellStructuresId = createObjectiveId("story-cell-structures");
const authoredWorkspace = {
  ...mockWorkspace,
  areas: mockWorkspace.areas.map((area, index) =>
    index === 0
      ? {
          ...area,
          objectives: [
            {
              id: cellStructuresId,
              title: "Cell structures",
              description: "Explain how organelles support the cell.",
              prerequisiteIds: [],
            },
          ],
          ai: {
            tutorInstructions: "Use short questions and everyday analogies.",
            quizInstructions: null,
            cardGenerationInstructions: "Keep each proposed card focused on one idea.",
          },
          cards: area.cards.map((card) => ({
            ...card,
            objectiveIds: [cellStructuresId],
            tags: ["biology", "exam"],
          })),
        }
      : area,
  ),
};
const clozeWorkspace = {
  ...authoredWorkspace,
  areas: authoredWorkspace.areas.map((area, index) =>
    index === 0
      ? {
          ...area,
          cards: area.cards.map((card, cardIndex) =>
            cardIndex === 0
              ? {
                  ...card,
                  front: "Mitochondria produce [energy molecule] through cellular respiration.",
                  back: "Mitochondria produce ATP through cellular respiration.",
                  cloze: {
                    text: "Mitochondria produce {{c1::ATP::energy molecule}} through {{c2::cellular respiration}}.",
                    deletionIndex: 1,
                  },
                }
              : card,
          ),
        }
      : area,
  ),
};

const meta = {
  title: "Screens/Recall Dashboard",
  component: RecallDashboard,
  parameters: {
    layout: "fullscreen",
    docs: {
      description: {
        component: "Full-screen product states rendered from stable, local mock data.",
      },
    },
  },
} satisfies Meta<typeof RecallDashboard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TodayDesktop: Story = {
  name: "Today · desktop",
  args: { demo: { workspace: mockWorkspace } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const DeletedCardPendingFirstSync: Story = {
  name: "Insights · offline deleted card pending first sync",
  args: { demo: { workspace: deletedCardPendingWorkspace, view: DashboardView.Insights } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const DeletedAreaPendingFirstSync: Story = {
  name: "Insights · offline deleted area pending first sync",
  args: { demo: { workspace: deletedAreaPendingWorkspace, view: DashboardView.Insights } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const LegacyDeletedReviewRecovery: Story = {
  name: "Insights · older deleted review content recovery",
  args: {
    demo: {
      workspace: legacyMissingReviewContentWorkspace,
      view: DashboardView.Insights,
      missingReviewContent: true,
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const LocalErasureBlocked: Story = {
  name: "Today · local cleanup recovery",
  args: { demo: { workspace: mockWorkspace, localErasureBlocked: true } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const StaleTabRecovery: Story = {
  name: "Today · newer workspace saved in another tab",
  args: { demo: { workspace: mockWorkspace, localSnapshotStale: true } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const ReviewSaving: Story = {
  name: "Today · saving review before advancing",
  args: { demo: { workspace: mockWorkspace, showAnswer: true, reviewSaveState: "saving" } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const ReviewSaveRecovery: Story = {
  name: "Today · retry failed review save",
  args: { demo: { workspace: mockWorkspace, showAnswer: true, reviewSaveState: "failure" } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const ReviewRecoveryInLibrary: Story = {
  name: "Explore · pending review recovery",
  args: {
    demo: {
      workspace: mockWorkspace,
      view: DashboardView.Library,
      showAnswer: true,
      reviewSaveState: "failure",
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const TodayMobile: Story = {
  name: "Today · mobile",
  args: { demo: { workspace: mockWorkspace } },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
};

export const AnswerRevealed: Story = {
  name: "Study · answer revealed",
  args: { demo: { workspace: mockWorkspace, showAnswer: true } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const StudyCardWithMedia: Story = {
  name: "Study · card with media",
  args: {
    demo: {
      workspace: mockWorkspace,
      mockMediaPreviews: [
        {
          mimeType: "image/svg+xml",
          url: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 300'%3E%3Crect width='640' height='300' rx='24' fill='%23eef4df'/%3E%3Ccircle cx='320' cy='150' r='92' fill='%23c4ed68'/%3E%3Ccircle cx='320' cy='150' r='54' fill='%23fffefa'/%3E%3Cpath d='M320 58v38m0 108v38m-92-92h38m108 0h38m-157-65 27 27m76 76 27 27m0-130-27 27m-76 76-27 27' stroke='%2342463d' stroke-width='12' stroke-linecap='round'/%3E%3Ctext x='320' y='275' text-anchor='middle' font-family='sans-serif' font-size='20' fill='%2342463d'%3Ecell structure illustration%3C/text%3E%3C/svg%3E",
        },
      ],
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const CaughtUp: Story = {
  name: "Study · caught up",
  args: { demo: { workspace: caughtUpWorkspace } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const Explore: Story = {
  name: "Explore · learning areas",
  args: { demo: { workspace: mockWorkspace, view: DashboardView.Library } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const EditLearningArea: Story = {
  name: "Library · edit learning area",
  args: { demo: { workspace: mockWorkspace, editAreaId: "area-biology" } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const AddCardWithMedia: Story = {
  name: "Library · add card with media",
  args: { demo: { workspace: mockWorkspace, selectedAreaId: "area-biology", addCard: true } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const EditCardObjectivesAndTags: Story = {
  name: "Library · edit card objectives and tags",
  args: {
    demo: {
      workspace: authoredWorkspace,
      selectedAreaId: "area-biology",
      editCardId: "bio-1",
      view: DashboardView.Library,
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

const staleCardDraft = authoredWorkspace.areas
  .flatMap((area) => area.cards)
  .find((card) => card.id === "bio-1");

export const StaleCardDraft: Story = {
  name: "Library · changed card preserves draft",
  args: {
    demo: {
      workspace: {
        ...authoredWorkspace,
        areas: authoredWorkspace.areas.map((area) => ({
          ...area,
          cards: area.cards.map((card) =>
            card.id === "bio-1"
              ? {
                  ...card,
                  back: "Latest synced answer: mitochondria produce ATP through cellular respiration.",
                }
              : card,
          ),
        })),
      },
      selectedAreaId: "area-biology",
      editCardId: "bio-1",
      ...(staleCardDraft ? { cardDraft: staleCardDraft } : {}),
      cardEditConflict: true,
      view: DashboardView.Library,
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const AreaObjectivesAndInstructions: Story = {
  name: "Explore · learning goals and AI instructions",
  args: {
    demo: {
      workspace: authoredWorkspace,
      selectedAreaId: "area-biology",
      areaSettings: true,
      view: DashboardView.Library,
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const ClozeQuestion: Story = {
  name: "Study · Cloze question",
  args: { demo: { workspace: clozeWorkspace, selectedAreaId: "area-biology" } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const ClozeAnswer: Story = {
  name: "Study · Cloze answer",
  args: { demo: { workspace: clozeWorkspace, selectedAreaId: "area-biology", showAnswer: true } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const EditClozeCard: Story = {
  name: "Library · edit Cloze card",
  args: {
    demo: { workspace: clozeWorkspace, selectedAreaId: "area-biology", editCardId: "bio-1" },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const Insights: Story = {
  name: "Insights · practice summary",
  args: { demo: { workspace: mockWorkspace, view: DashboardView.Insights } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const PracticeHistory: Story = {
  name: "Insights · daily and weekly practice",
  args: { demo: { workspace: practiceWorkspace, view: DashboardView.Insights } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const ReviewSyncConflict: Story = {
  name: "Insights · review sync conflict",
  args: { demo: { workspace: reviewConflictWorkspace, view: DashboardView.Insights } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const DifferentAccountWorkspace: Story = {
  name: "Today · different account workspace",
  args: {
    demo: {
      workspace: { ...mockWorkspace, syncOwnerId: "87654321-4321-4321-8321-abcdefabcdef" },
      syncAccountState: "account-mismatch",
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const LegacyAccountAdoption: Story = {
  name: "Today · confirm older workspace ownership",
  args: {
    demo: {
      workspace: { ...mockWorkspace, syncCursor: "12" },
      syncAccountState: "owner-adoption-required",
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const AccountBindingStorageFailure: Story = {
  name: "Today · account binding storage failure",
  args: { demo: { workspace: mockWorkspace, syncAccountState: "ownership-checkpoint" } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const EmptyLibrary: Story = {
  name: "Today · empty library",
  args: { demo: { workspace: emptyWorkspace } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

const originalAreaDraft = authoredWorkspace.areas.find((area) => area.id === "area-biology");
export const StaleAreaDraft: Story = {
  name: "Library · changed area preserves draft",
  args: {
    demo: {
      workspace: {
        ...authoredWorkspace,
        areas: authoredWorkspace.areas.map((area) =>
          area.id === "area-biology"
            ? {
                ...area,
                title: "Biology: latest synced revision",
                description: "Updated goals from another device.",
                tags: ["biology", "updated"],
              }
            : area,
        ),
      },
      editAreaId: "area-biology",
      ...(originalAreaDraft ? { areaDraft: originalAreaDraft } : {}),
      areaEditFailure: "stale-content",
      view: DashboardView.Library,
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};
export const AreaSaveFailure: Story = {
  name: "Library · area save failure preserves draft",
  args: {
    demo: {
      workspace: authoredWorkspace,
      editAreaId: "area-biology",
      ...(originalAreaDraft ? { areaDraft: originalAreaDraft } : {}),
      areaEditFailure: "storage",
      view: DashboardView.Library,
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};
export const AreaDeletionFailure: Story = {
  name: "Library · retry failed area deletion",
  args: {
    demo: {
      workspace: authoredWorkspace,
      selectedAreaId: "area-biology",
      deletionFailure: "area",
      view: DashboardView.Library,
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};
export const CardDeletionFailure: Story = {
  name: "Library · retry failed card deletion",
  args: {
    demo: {
      workspace: authoredWorkspace,
      selectedAreaId: "area-biology",
      deletionFailure: "card",
      view: DashboardView.Library,
    },
  },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};
