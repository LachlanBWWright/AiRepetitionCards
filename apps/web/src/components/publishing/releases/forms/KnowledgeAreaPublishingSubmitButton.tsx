import { Button } from "@/components/ui/Button";

type Props = {
  readonly busy: boolean;
  readonly blocked: boolean;
  readonly license: string;
  readonly needsReuseConfirmation: boolean;
  readonly reuseConfirmed: boolean;
};

export function KnowledgeAreaPublishingSubmitButton({
  busy,
  blocked,
  license,
  needsReuseConfirmation,
  reuseConfirmed,
}: Props) {
  return (
    <Button
      className="self-start"
      type="submit"
      disabled={busy || blocked || !license.trim() || (needsReuseConfirmation && !reuseConfirmed)}
    >
      Publish area
    </Button>
  );
}
