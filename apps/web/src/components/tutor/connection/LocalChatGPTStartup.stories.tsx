import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { Button } from "@recall/ui-web";
import { LocalChatGPTTutor } from "./LocalChatGPTTutor";
import { useLocalChatGPTConnection } from "./LocalChatGPTConnectionProvider";
import { knowledgeArea, onApprove } from "../practice/TutorPanel.stories.fixtures";

function BackgroundConnection() {
  const connection = useLocalChatGPTConnection();
  const [panels, setPanels] = useState(0);
  return (
    <main className="flex flex-col gap-4 p-6">
      <p role="status">
        {connection.checking
          ? "Restoring saved connection…"
          : connection.models.length
            ? "Background connection ready"
            : "ChatGPT not connected"}
      </p>
      <Button
        onClick={() => {
          setPanels((count) => count + 1);
        }}
      >
        Open AI panel
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setPanels(0);
        }}
      >
        Close AI panels
      </Button>
      {Array.from({ length: panels }, (_, index) => (
        <LocalChatGPTTutor
          key={index}
          knowledgeArea={knowledgeArea}
          onApprove={onApprove}
          renderContent={(_api, context) => (
            <section aria-label={`AI panel ${String(index + 1)}`} className="flex flex-col gap-4">
              <p>{context.unavailableReason ?? "ChatGPT ready for requests"}</p>
              <p>Selected model: {context.modelSelection?.value || "none"}</p>
              {context.connectionPrompt}
            </section>
          )}
        />
      ))}
    </main>
  );
}
const meta = {
  title: "Screens/Desktop ChatGPT Startup",
  component: BackgroundConnection,
} satisfies Meta<typeof BackgroundConnection>;
export default meta;
type Story = StoryObj<typeof meta>;
export const BackgroundRestoration: Story = {};
