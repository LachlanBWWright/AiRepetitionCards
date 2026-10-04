import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Effect } from "effect";
import { DailyReminderSettingsPanel } from "./DailyReminderSettingsPanel";
import type { DailyReminderSnapshot } from "@/lib/daily-reminder-api";
const snapshot: DailyReminderSnapshot = {
  settings: { enabled: true, hour: 19, minute: 0 },
  supported: true,
  lastDeliveredDay: "2026-10-04",
  error: null,
};
const meta = {
  title: "Screens/Daily Study Reminders",
  component: DailyReminderSettingsPanel,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <main className="component-catalog tutor-story">
        <div>
          <h1>Device settings</h1>
          <Story />
        </div>
      </main>
    ),
  ],
  args: {
    initialSnapshot: snapshot,
    api: {
      read: () => Effect.succeed(snapshot),
      set: (settings) => Effect.succeed({ ...snapshot, settings }),
    },
  },
} satisfies Meta<typeof DailyReminderSettingsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BrowserEnabled: Story = {};
export const DesktopEnabled: Story = { args: { desktop: true } };
export const Disabled: Story = {
  args: { initialSnapshot: { ...snapshot, settings: { ...snapshot.settings, enabled: false } } },
};
export const Blocked: Story = {
  args: {
    initialSnapshot: {
      ...snapshot,
      error: "Notifications are blocked. Change this site's permission in browser settings.",
    },
    api: {
      read: () => Effect.succeed(snapshot),
      set: () =>
        Effect.fail({
          _tag: "DailyReminderFailure",
          message: "Permission denied. Your edited reminder time has been retained.",
        }),
    },
  },
};
