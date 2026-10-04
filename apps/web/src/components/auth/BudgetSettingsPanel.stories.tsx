import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { type LocalAiUsageSnapshot, localBudgetFailure } from "@recall/application";
import { BudgetSettingsPanel } from "./BudgetSettingsPanel";
const period = {
  requests: 12,
  researchRequests: 2,
  completed: 10,
  failed: 1,
  pending: 1,
  inputTokens: 3400,
  outputTokens: 2200,
  unknownUsageRequests: 2,
};
const snapshot: LocalAiUsageSnapshot = {
  policy: {
    accountId: "demo-account",
    dailyRequestLimit: 20,
    weeklyRequestLimit: 100,
    dailyResearchLimit: 4,
  },
  summary: { daily: period, weekly: { ...period, requests: 38 } },
  entries: [],
};
const api = { read: () => Effect.succeed(snapshot), setBudget: () => Effect.succeed(snapshot) };
const meta = {
  title: "Screens/AI Budget Settings",
  component: BudgetSettingsPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="component-catalog tutor-story">
        <div>
          <h1>Manage study usage</h1>
          <Story />
        </div>
      </main>
    ),
  ],
  args: { api, accountId: "demo-account", initialSnapshot: snapshot },
} satisfies Meta<typeof BudgetSettingsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Usage: Story = {};
export const Unlimited: Story = {
  args: {
    initialSnapshot: {
      ...snapshot,
      policy: {
        ...snapshot.policy,
        dailyRequestLimit: null,
        weeklyRequestLimit: null,
        dailyResearchLimit: null,
      },
    },
  },
};
export const Blocked: Story = {
  args: { initialSnapshot: { ...snapshot, policy: { ...snapshot.policy, dailyRequestLimit: 0 } } },
};
export const SaveUnavailable: Story = {
  args: {
    api: {
      ...api,
      setBudget: () =>
        Effect.fail(
          localBudgetFailure("Storage unavailable. Your edited limits have not been saved."),
        ),
    },
  },
};
