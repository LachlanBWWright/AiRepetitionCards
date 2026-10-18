import { Alert, Input } from "@recall/ui-web";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

export function AccountActionDeleteConfirmation({
  accountDeleted,
  confirmation,
  deleting,
  message,
  onCancel,
  onChange,
  onClose,
  onConfirm,
  open,
}: {
  accountDeleted: boolean;
  confirmation: string;
  deleting: boolean;
  message: string | null;
  onCancel: () => void;
  onChange: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  open: boolean;
}) {
  if (!open) return null;

  return (
    <Dialog labelledBy="delete-account-title" onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <DialogHeader>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            ACCOUNT SETTINGS
          </p>
          <DialogTitle id="delete-account-title">Delete your account?</DialogTitle>
        </DialogHeader>
        <DialogDescription>
          This permanently deletes your account and synced learning data. Download an account export
          first if you want a copy.
        </DialogDescription>
        <label htmlFor="delete-account-confirmation">Type DELETE to confirm</label>
        <Input
          id="delete-account-confirmation"
          autoComplete="off"
          value={confirmation}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          disabled={deleting}
          required
        />
        {message && <Alert variant="destructive">{message}</Alert>}
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="secondary" type="button" disabled={deleting} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="danger"
            type="submit"
            disabled={deleting || (!accountDeleted && confirmation !== "DELETE")}
          >
            {deleting
              ? "Deleting…"
              : accountDeleted
                ? "Retry clearing this tab"
                : "Delete account and data"}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
