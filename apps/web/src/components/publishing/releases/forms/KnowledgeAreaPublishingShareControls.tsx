import { Button } from "@/components/ui/Button";

type Props = {
  readonly embedded: boolean;
  readonly busy: boolean;
  readonly shareToken: string | null;
  readonly manageShareToken: (action: "rotate" | "revoke") => Promise<void>;
};

export function KnowledgeAreaPublishingShareControls({
  embedded,
  busy,
  shareToken,
  manageShareToken,
}: Props) {
  const actions = shareToken ? (
    <>
      <p>Anyone with the share link can open this area.</p>
      <div className="flex flex-wrap gap-3">
        <Button type="button" disabled={busy} onClick={() => void manageShareToken("rotate")}>
          Rotate link
        </Button>
        <Button type="button" disabled={busy} onClick={() => void manageShareToken("revoke")}>
          Revoke link
        </Button>
      </div>
    </>
  ) : (
    <>
      <p>This unlisted area has no active share link.</p>
      <Button type="button" disabled={busy} onClick={() => void manageShareToken("rotate")}>
        Create share link
      </Button>
    </>
  );

  return (
    <div
      className={
        embedded ? "grid gap-2 border-t pt-4" : "grid gap-2 rounded-xl border bg-muted/40 p-4"
      }
      aria-live="polite"
    >
      <p className="mb-0 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        UNLISTED LINK ACCESS
      </p>
      {actions}
    </div>
  );
}
