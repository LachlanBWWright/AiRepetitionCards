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
    <DialogFooter className="grid grid-cols-[auto_minmax(0,1fr)] sm:flex sm:justify-between">
      <Button
        size="default"
        variant="secondary"
        type="button"
        disabled={props.saving}
        onClick={props.onCancel}
        className="order-2 sm:order-0"
      >
        Cancel
      </Button>
      {!props.editing && (
        <Button
          size="default"
          variant="secondary"
          type="submit"
          disabled={props.saving || !props.duplicatesAccepted || !props.canSave}
          data-save-another="true"
          className="order-3 sm:order-1 sm:ml-auto"
        >
          Save &amp; add another
        </Button>
      )}
      <Button
        size="default"
        type="submit"
        disabled={props.saving || !props.canSave}
        className="order-1 col-span-2 sm:order-2 sm:col-auto"
      >
        {props.saving ? "Saving card…" : props.editing ? "Save changes" : "Save card"}
      </Button>
    </DialogFooter>
  );
}
