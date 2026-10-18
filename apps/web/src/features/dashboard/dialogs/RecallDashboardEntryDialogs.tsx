import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Alert } from "@recall/ui-web/components/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@recall/ui-web/components/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";

export type DashboardConfirmation = {
  readonly description: string;
  readonly onConfirm: () => unknown;
  readonly onCancel?: () => void;
};

export function RecallDashboardEntryDialogs({
  confirmation,
  workspaceUnlocked,
  onClearConfirmation,
  draftClose,
  onDraftCloseChange,
  draftError,
  onRetryDraftSave,
  onDiscardDraft,
  draftsLoaded,
  onKeepDraftClose,
  creationChoices,
  onCreationChoicesChange,
  areaTitle,
  onAddCard,
  onGenerateCards,
  onImportCards,
  onFinishLater,
}: {
  readonly confirmation: DashboardConfirmation | null;
  readonly workspaceUnlocked: boolean;
  readonly onClearConfirmation: () => void;
  readonly draftClose: "card" | "area" | null;
  readonly onDraftCloseChange: (kind: "card" | "area" | null) => void;
  readonly draftError: string | null;
  readonly onRetryDraftSave: () => void;
  readonly onDiscardDraft: () => void;
  readonly draftsLoaded: boolean;
  readonly onKeepDraftClose: () => void;
  readonly creationChoices: boolean;
  readonly onCreationChoicesChange: (open: boolean) => void;
  readonly areaTitle: string | undefined;
  readonly onAddCard: () => void;
  readonly onGenerateCards: () => void;
  readonly onImportCards: () => void;
  readonly onFinishLater: () => void;
}): ReactNode {
  return (
    <>
      <AlertDialog
        open={confirmation !== null && workspaceUnlocked}
        onOpenChange={(open) => {
          if (!open && confirmation) {
            onClearConfirmation();
            confirmation.onCancel?.();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">
              {confirmation?.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                const selected = confirmation;
                onClearConfirmation();
                if (selected) void selected.onConfirm();
              }}
            >
              Confirm
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={draftClose !== null}
        onOpenChange={(open) => {
          if (!open) onDraftCloseChange(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Keep this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              Your edits haven’t been saved as a card or subject. Keep the draft to resume it later
              in this tab, or discard it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {draftError && (
            <Alert variant="destructive">
              {draftError}
              <Button onClick={onRetryDraftSave}>Retry draft save</Button>
            </Alert>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Continue editing</AlertDialogCancel>
            <Button variant="secondary" onClick={onDiscardDraft}>
              Discard draft
            </Button>
            <Button disabled={!draftsLoaded} onClick={onKeepDraftClose}>
              Keep draft and close
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={creationChoices && workspaceUnlocked} onOpenChange={onCreationChoicesChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add cards to {areaTitle}</DialogTitle>
            <DialogDescription>
              Choose how to build your subject. AI suggestions need your approval before becoming
              study cards. Importing creates a separate deck.
            </DialogDescription>
          </DialogHeader>
          <Button onClick={onAddCard}>Write manually</Button>
          <Button variant="secondary" onClick={onGenerateCards}>
            Generate from materials
          </Button>
          <Button variant="secondary" onClick={onImportCards}>
            Import existing cards
          </Button>
          <Button variant="secondary" onClick={onFinishLater}>
            Finish later
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
