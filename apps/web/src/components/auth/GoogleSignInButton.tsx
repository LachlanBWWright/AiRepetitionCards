import { Button } from "@/components/ui/Button";

export function GoogleSignInButton({
  busy,
  onClick,
}: {
  readonly busy: boolean;
  readonly onClick: () => void;
}) {
  return (
    <Button type="button" variant="default" disabled={busy} onClick={onClick} aria-busy={busy}>
      {busy ? "Opening Google…" : "Continue with Google"}
    </Button>
  );
}
