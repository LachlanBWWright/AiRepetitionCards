import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { tutorApi } from "@/lib/tutor-api";
import { Effect } from "effect";
import { Button } from "@recall/ui-web";
import { askSubjectTutor, tutorApiFailureMessage } from "@recall/application";
import { AiFundingSettings } from "./AiFundingSettings";
import { useBrowserAiFunding } from "./AiFundingProvider";
import { LocalChatGPTTutor } from "../connection/LocalChatGPTTutor";
import { knowledgeArea, onApprove } from "../practice/TutorPanel.stories.fixtures";

function FundingScreen() {
  const funding = useBrowserAiFunding();
  const [message, setMessage] = useState("");
  const ask = (api: typeof tutorApi) => {
    Effect.runFork(
      askSubjectTutor(api, knowledgeArea, [], "Explain cell membranes").pipe(
        Effect.match({
          onSuccess: () => {
            setMessage("Managed answer received");
          },
          onFailure: (failure) => {
            setMessage(tutorApiFailureMessage(failure));
          },
        }),
      ),
    );
  };
  return (
    <main className="mx-auto max-w-xl space-y-6 p-6">
      <AiFundingSettings />
      <p>Selected access: {funding?.mode ?? "byo"}</p>
      <p>Recall account: {funding?.owner ?? "signed out"}</p>
      <LocalChatGPTTutor
        knowledgeArea={knowledgeArea}
        onApprove={onApprove}
        renderContent={(api, context) => (
          <section className="space-y-3">
            <p>{context.unavailableReason ?? "AI ready"}</p>
            <p>Conversation scope: {context.sessionNamespace}</p>
            <Button
              disabled={Boolean(context.unavailableReason)}
              onClick={() => {
                ask(api);
              }}
            >
              Ask a question
            </Button>
          </section>
        )}
      />
      <p role="status">{message}</p>
    </main>
  );
}
const meta = { title: "Screens/AI Funding", component: FundingScreen } satisfies Meta<
  typeof FundingScreen
>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AccountScoped: Story = {};
