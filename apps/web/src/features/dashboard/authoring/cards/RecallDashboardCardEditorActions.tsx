import { Button } from "@/components/ui/Button";
import { DialogFooter } from "@recall/ui-web/components/dialog";

type Props = {
  readonly editing: boolean;
  readonly saving: boolean;
  readonly duplicatesAccepted: boolean;
  readonly canSave: boolean;
  readonly onCancel: () => void;
};

export function RecallDashboardCardEditorActions(props: Props) {
  return (
    <DialogFooter className="flex flex-wrap items-center justify-end gap-2">
      {!props.editing && (
        <Button
          size="small"
          type="submit"
          disabled={props.saving || !props.duplicatesAccepted || !props.canSave}
          data-save-another="true"
        >
          Save and add another
        </Button>
      )}
      <Button size="small" type="button" onClick={props.onCancel}>
        Cancel
      </Button>
      <Button size="small" type="submit" disabled={props.saving || !props.canSave}>
        {props.saving ? "Saving card…" : props.editing ? "Save changes" : "Save and finish"}
      </Button>
    </DialogFooter>
  );
}
