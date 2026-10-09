import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { NativeWorkspaceSearchPanel } from "../../../mobile/src/components/NativeWorkspaceSearchPanel";
import { mockWorkspace } from "../features/workspace/mock-data";

const meta = {
  title: "Screens/Native Workspace Search",
  component: NativeWorkspaceSearchPanel,
  parameters: { layout: "fullscreen" },
  args: { workspace: mockWorkspace, initialNotebooks: [], onNavigate: () => undefined },
  globals: { viewport: { value: "recallMobile", isRotated: false } },
  decorators: [
    (Story) => (
      <main style={{ minHeight: 844, padding: 16, background: "#faf9f6" }}>
        <Story />
      </main>
    ),
  ],
} satisfies Meta<typeof NativeWorkspaceSearchPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Search: Story = {};
export const CardMatches: Story = {
  args: { initialQuery: mockWorkspace.areas[0]?.cards[0]?.front.split(" ")[0] ?? "cell" },
};
export const NoMatches: Story = { args: { initialQuery: "no-matching-material" } };
