import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import RecallDashboard from "../features/dashboard/RecallDashboard";
import { caughtUpWorkspace, emptyWorkspace, mockWorkspace } from "../features/workspace/mock-data";

const firstReviewId = mockWorkspace.reviewEvents?.[0]?.id;
const reviewConflictWorkspace = {
  ...mockWorkspace,
  reviewConflictIds: firstReviewId ? [firstReviewId] : [],
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
  args: { demo: { workspace: mockWorkspace, view: "Explore" } },
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

export const Insights: Story = {
  name: "Insights · practice summary",
  args: { demo: { workspace: mockWorkspace, view: "Insights" } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const ReviewSyncConflict: Story = {
  name: "Insights · review sync conflict",
  args: { demo: { workspace: reviewConflictWorkspace, view: "Insights" } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};

export const EmptyLibrary: Story = {
  name: "Today · empty library",
  args: { demo: { workspace: emptyWorkspace } },
  globals: { viewport: { value: "recallDesktop", isRotated: false } },
};
