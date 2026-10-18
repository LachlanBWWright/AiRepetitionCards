import { useState } from "react";
import { Button } from "@recall/ui-web";
import { Checkbox } from "@/components/ui/Checkbox";
import { Label } from "@recall/ui-web/components/label";
import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";
export function NotebookBatchApproval({ model }: { readonly model: KnowledgeNotebookModel }) {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const entries = model.pendingProposals;
  const selectedIds = entries
    .filter((entry) => selected.includes(entry.id))
    .map((entry) => entry.id);
  if (entries.length < 2) return null;
  const invalid = entries.some((entry) => {
    if (!selected.includes(entry.id)) return false;
    const duplicates = model.proposalDuplicates(entry, model.drafts[entry.id] ?? entry.proposal);
    return duplicates.matches.length > 0 && !duplicates.acknowledged;
  });
  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="Approve selected proposals">
      <p className="text-sm text-muted-foreground">
        Select proposals after reviewing their question, answer, and rationale below. Approval saves
        selected cards one at a time; if saving fails, the remaining proposals stay pending.
      </p>
      {entries.map((entry) => (
        <Label key={entry.id} className="flex items-start gap-3">
          <Checkbox
            checked={selected.includes(entry.id)}
            disabled={model.busy || model.unsaved}
            onCheckedChange={(checked) => {
              setSelected((current) =>
                checked === true ? [...current, entry.id] : current.filter((id) => id !== entry.id),
              );
            }}
          />
          {model.drafts[entry.id]?.front ?? entry.proposal.front}
        </Label>
      ))}
      <Button
        disabled={model.busy || model.unsaved || selectedIds.length === 0 || invalid}
        onClick={() => {
          model.approveSelected(selectedIds);
        }}
      >
        Approve selected ({selectedIds.length})
      </Button>
      {invalid && (
        <p className="text-sm text-muted-foreground">
          Resolve duplicate warnings on the selected proposals first.
        </p>
      )}
    </section>
  );
}
