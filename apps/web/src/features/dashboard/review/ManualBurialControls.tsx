import type { Assessment, Workspace } from "@recall/domain";
import { Button } from "@recall/ui-web";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@recall/ui-web/components/dropdown-menu";

export function ManualBurialControls({
  workspace,
  card,
  disabled,
  onBury,
  onUnbury,
  now,
}: {
  readonly workspace: Workspace;
  readonly card: Assessment | undefined;
  readonly disabled: boolean;
  readonly onBury: (id: Assessment["id"], scope: "card" | "note", now: number) => void;
  readonly onUnbury: () => void;
  readonly now: number;
}) {
  const buried = Object.values(workspace.schedulerSettings?.manualBurials ?? {}).some(
    (until) => until > now,
  );
  if (!card && !buried) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {card && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" disabled={disabled}>
              Bury until tomorrow
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem
              onSelect={() => {
                onBury(card.id, "card", Date.now());
              }}
            >
              Bury this card
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onBury(card.id, "note", Date.now());
              }}
            >
              Bury this note and its cards
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {buried && (
        <Button variant="secondary" disabled={disabled} onClick={onUnbury}>
          Unbury cards
        </Button>
      )}
    </div>
  );
}
