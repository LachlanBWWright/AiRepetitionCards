import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dialog } from "@recall/ui-web/components/dialog";
import { ReviewHelpDialog } from "./ReviewHelpDialog";
import { ReviewRepairPanel } from "./ReviewRepairPanel";
import { NativeReviewCardHelp } from "../../../../../../mobile/src/components/review/assistance/NativeReviewCardHelp";
import { useReviewRepairPreview, type RepairScenario } from "./stories/useReviewRepairPreview";

function ReviewRepairStory({
  dialog = false,
  native = false,
  scenario = "default",
}: {
  readonly dialog?: boolean;
  readonly native?: boolean;
  readonly scenario?: RepairScenario;
}) {
  const preview = useReviewRepairPreview(scenario);
  const { area, workspace, original } = preview;
  if (!area) return null;
  const panel = (
    <ReviewRepairPanel
      api={preview.api}
      workspace={workspace}
      area={area}
      card={original}
      disabled={scenario === "readonly"}
      onBusyChange={() => undefined}
      save={preview.save}
    />
  );
  return (
    <main
      data-native-preview={native || undefined}
      className={`mx-auto space-y-6 p-4 ${native ? "max-w-md" : "max-w-2xl"}`}
    >
      <p className="text-xs text-muted-foreground">
        {native
          ? "React Native components rendered in Storybook via React Native Web"
          : "Next.js components in Storybook"}{" "}
        · Mocked AI and storage
      </p>
      {native ? (
        <NativeReviewCardHelp
          workspace={workspace}
          area={area}
          card={original}
          api={preview.api}
          save={scenario === "readonly" ? undefined : preview.nativeSave}
          disabled={false}
          onInteractionChange={preview.setPaused}
        />
      ) : dialog ? (
        <Dialog defaultOpen>
          <ReviewHelpDialog>{panel}</ReviewHelpDialog>
        </Dialog>
      ) : (
        panel
      )}
      <p role="status">Saved cards: {area.cards.length}</p>
      <p>Original present: {String(area.cards.some((card) => card.id === original.id))}</p>
      <p>Review events: {workspace.reviewEvents?.length ?? 0}</p>
      {native && <p>Reviews paused: {String(preview.paused)}</p>}
    </main>
  );
}
const meta = {
  title: "Knowledge/Review assistance",
  component: ReviewRepairStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ReviewRepairStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const DialogPreview: Story = { args: { dialog: true } };
export const NativePreview: Story = { args: { native: true } };
export const WebDuplicates: Story = { args: { scenario: "duplicates" } };
export const NativeDuplicates: Story = { args: { native: true, scenario: "duplicates" } };
export const WebFailure: Story = { args: { scenario: "error" } };
export const NativeFailure: Story = { args: { native: true, scenario: "error" } };
export const WebSlow: Story = { args: { scenario: "slow" } };
export const NativeSlow: Story = { args: { native: true, scenario: "slow" } };
export const NativeReadonly: Story = { args: { native: true, scenario: "readonly" } };
