import { Button } from "@recall/ui-web";

type Props = {
  readonly onSave: () => void;
  readonly onRestore: () => void;
};

export function WorkspaceBackupActions({ onSave, onRestore }: Props) {
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <BackupAction
        title="Save a backup"
        description="Download all decks, schedules, review history and attachments."
        action="Save workspace backup"
        variant="default"
        onClick={onSave}
      />
      <BackupAction
        title="Restore a backup"
        description="Choose a backup file to replace the current workspace."
        action="Restore backup"
        variant="secondary"
        onClick={onRestore}
      />
      <p className="text-sm leading-6 text-muted-foreground">
        Drafts and editing flags are stored separately from workspace backups.
      </p>
    </div>
  );
}

function BackupAction({
  title,
  description,
  action,
  variant,
  onClick,
}: {
  readonly title: string;
  readonly description: string;
  readonly action: string;
  readonly variant: "default" | "secondary";
  readonly onClick: () => void;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label={title}>
      <header className="flex flex-col gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="max-w-prose text-sm leading-6 text-muted-foreground">{description}</p>
      </header>
      <Button className="w-full" variant={variant} onClick={onClick}>
        {action}
      </Button>
    </section>
  );
}
