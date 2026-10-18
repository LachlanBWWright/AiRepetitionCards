import { improvementMessages, improvementOpening } from "@recall/application";
import { Button } from "@recall/ui-web";
import { Alert } from "@recall/ui-web/components/alert";
import { Tabs } from "@recall/ui-web/components/tabs";
import type { ChatModelSelection } from "./ChatModelPicker";
import { ChatRoom } from "./ChatRoom";
import { KnowledgeNotebookSuggestions } from "../notebook/proposals/KnowledgeNotebookSuggestions";
import type { KnowledgeNotebookModel } from "../notebook/useKnowledgeNotebookModel";
export function ImprovementChat({
  model,
  modelSelection,
  unavailableReason,
}: {
  readonly model: KnowledgeNotebookModel;
  readonly modelSelection?: ChatModelSelection | undefined;
  readonly unavailableReason?: string | null | undefined;
}) {
  const history = improvementMessages(model.notebook);
  const messages = history.length
    ? history
    : [
        {
          id: "opening",
          role: "assistant" as const,
          content: improvementOpening(model.knowledgeArea),
        },
      ];
  const pending = model.pendingProposals.length > 0;
  function retrySave() {
    if (model.notebook) model.run(model.save(model.notebook));
  }
  return (
    <ChatRoom
      label="Improve"
      modelSelection={modelSelection}
      inputId={`improve-message-${model.knowledgeArea.id}`}
      greeting="What would you like to improve?"
      placeholder="Message Improve…"
      messages={messages}
      value={model.answer}
      onChange={model.setAnswer}
      onSend={() => {
        model.sendChatMessage(model.answer);
      }}
      busy={model.busy}
      disabled={model.networkDisabled || Boolean(unavailableReason)}
      maxLength={model.notebook ? 8000 : 2000}
      afterMessages={
        <>
          {unavailableReason && (
            <p className="text-sm text-muted-foreground" role="status">
              {unavailableReason}
            </p>
          )}
          {pending && (
            <Tabs value="suggestions" aria-label="Proposed cards">
              <KnowledgeNotebookSuggestions model={model} chat />
            </Tabs>
          )}
          {model.accepted.length > 0 && (
            <p role="status" className="text-xs text-muted-foreground">
              {model.accepted.length === 1
                ? "Card added to your deck."
                : `${String(model.accepted.length)} cards added to your deck.`}
            </p>
          )}
          {model.message && <Alert variant="destructive">{model.message}</Alert>}
          {model.unsaved && (
            <Alert>
              Your conversation has unsaved changes.
              <Button variant="secondary" disabled={model.busy} onClick={retrySave}>
                Retry save
              </Button>
            </Alert>
          )}
          {!model.loaded && !model.demo && (
            <Button variant="secondary" disabled={model.busy} onClick={model.reloadNotebook}>
              Retry loading conversation
            </Button>
          )}
        </>
      }
    />
  );
}
