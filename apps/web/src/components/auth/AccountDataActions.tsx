import { Download, Trash2 } from "lucide-react";
import { Button } from "@recall/ui-web";

export function AccountDataActions({
  busy,
  onExport,
  onDelete,
}: {
  readonly busy: boolean;
  readonly onExport: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <div className="grid gap-3">
      <Button className="w-full" variant="secondary" disabled={busy} onClick={onExport}>
        <Download aria-hidden="true" className="size-4" />
        {busy ? "Preparing export…" : "Export account data"}
      </Button>
      <Button className="w-full" variant="destructive" onClick={onDelete}>
        <Trash2 aria-hidden="true" className="size-4" />
        Delete account
      </Button>
    </div>
  );
}
