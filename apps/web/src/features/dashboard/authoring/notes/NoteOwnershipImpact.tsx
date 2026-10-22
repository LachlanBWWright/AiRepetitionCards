import type { NoteAuthoringModel } from "@recall/react";
import { Checkbox } from "@recall/ui-web/components/checkbox";
export function NoteOwnershipImpact({ model }: { readonly model: NoteAuthoringModel }) {
  if (!model.ownershipConflicts.length) return null;
  return (
    <div className="grid gap-2 rounded border border-destructive/50 p-3 text-sm">
      <p>Linked subjects contain stale or independently edited note snapshots.</p>
      {model.ownershipConflicts.map((conflict) => (
        <div key={`${conflict.areaId}:${conflict.noteId}`}>
          <p className="font-medium">{conflict.areaTitle}</p>
          {Object.entries(conflict.fields).map(([name, value]) => (
            <p key={name} className="break-words">
              {name}: {value}
            </p>
          ))}
        </div>
      ))}
      <label className="flex items-center gap-2">
        <Checkbox
          checked={model.migration?.confirmLinkedSnapshots ?? false}
          onCheckedChange={(value) => {
            model.confirmLinkedSnapshots(value === true);
          }}
        />
        Replace these snapshots with this source note when saving
      </label>
    </div>
  );
}
