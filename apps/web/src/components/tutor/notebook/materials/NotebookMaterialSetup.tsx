import { Button, Input } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";
export function NotebookMaterialSetup({ model }: { readonly model: KnowledgeNotebookModel }) {
  return (
    <form
      className="space-y-3 rounded-lg border p-6"
      onSubmit={(event) => {
        event.preventDefault();
        model.createNotebook();
      }}
    >
      <h3 className="text-lg font-semibold">Add your study materials</h3>
      <p className="text-sm text-muted-foreground">
        Give this subject a learning goal, then add notes or import a document. You can start an
        investigation in Improve when you’re ready.
      </p>
      <Label>
        Learning goal
        <Input
          value={model.goal}
          maxLength={2000}
          required
          onChange={(event) => {
            model.setGoal(event.target.value);
          }}
        />
      </Label>
      <Button
        type="submit"
        disabled={!model.loaded || model.busy || model.unsaved || !model.goal.trim()}
      >
        Create material notebook
      </Button>
    </form>
  );
}
