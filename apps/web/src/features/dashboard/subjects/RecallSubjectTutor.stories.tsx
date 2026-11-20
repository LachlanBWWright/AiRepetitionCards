import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Effect } from "effect";
import type { TutorActionResponse } from "@recall/ai-core";
import { createTutorApi, toKnowledgeArea, type TutorApiFailure } from "@recall/application";
import { createAreaId } from "@recall/domain";
import { Button } from "@recall/ui-web";
import { RecallSubjectTutor } from "./RecallSubjectTutor";

const area = Effect.runSync(
  toKnowledgeArea(
    { id: createAreaId("retention-area"), title: "Cell biology", color: "#123456", cards: [] },
    true,
    true,
  ),
);
const api: ReturnType<typeof createTutorApi> = {
  ...createTutorApi(() => Effect.succeed({ status: 503, body: null })),
  request: (input): Effect.Effect<TutorActionResponse, TutorApiFailure> =>
    input.action === "question"
      ? Effect.succeed({
          action: "question",
          sessionId: "00000000-0000-4000-8000-000000000001",
          proposalId: "00000000-0000-4000-8000-000000000002",
          providerResolutionRequired: false,
          result: {
            question: "Mitochondria generate ATP through cellular respiration.",
            teachingIntent: "Explain the requested concept.",
            objectiveId: null,
          },
        })
      : Effect.fail({ _tag: "TutorApiFailure", reason: "invalid-response" }),
};
function ConversationStory() {
  const [owner, setOwner] = useState("account-a:provider-a");
  return (
    <main className="flex h-screen flex-col p-4">
      <Button
        onClick={() => {
          setOwner((current) =>
            current === "account-a:provider-a" ? "account-b:provider-b" : "account-a:provider-a",
          );
        }}
      >
        Switch account and provider
      </Button>
      <p>Current scope: {owner}</p>
      <RecallSubjectTutor
        key={owner}
        area={area}
        api={api}
        disabled={false}
        conversationScope={`storybook:${owner}`}
      />
    </main>
  );
}
const meta = {
  title: "Knowledge/Tutor conversation",
  component: ConversationStory,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ConversationStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
