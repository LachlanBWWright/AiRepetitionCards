import type { StoryObj } from "@storybook/nextjs-vite";
import RecallDashboard from "../features/dashboard/RecallDashboard";
import { DashboardView } from "../features/dashboard/navigation/dashboard-navigation";
import { emptyWorkspace, mockWorkspace } from "../features/workspace/mock-data";
import { authoredWorkspace } from "./RecallDashboard.story-fixtures";

type Story = StoryObj<typeof RecallDashboard>;

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
