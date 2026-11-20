import { MoreHorizontal } from "lucide-react";
import { Button } from "@recall/ui-web";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import type { ReviewCardProps } from "./ReviewCardProps";

type Props = {
  readonly card: ReviewCardProps["card"];
  readonly helpAction: ReviewCardProps["helpAction"];
  readonly flagged: boolean;
  readonly onFlag: ReviewCardProps["onFlag"];
  readonly onEdit: ReviewCardProps["onEdit"];
  readonly onDelete: ReviewCardProps["onDelete"];
  readonly disabled: boolean;
};
export function ReviewCardActions({
  card,
  helpAction,
  flagged,
  onFlag,
  onEdit,
  onDelete,
  disabled,
}: Props) {
  if (!card) return null;
  const edit = () => {
    onEdit?.(card);
  };
  const remove = () => {
    onDelete?.(card);
  };
  return (
    <div className="flex max-w-full flex-wrap items-center gap-2 sm:ml-auto">
      {helpAction}
      {onFlag && (
        <Button
          variant="secondary"
          disabled={disabled}
          aria-pressed={flagged}
          onClick={() => {
            onFlag(card);
          }}
        >
          {flagged ? "Flagged for editing" : "Improve later"}
        </Button>
      )}
      {(onEdit || onDelete) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary" size="icon" disabled={disabled} aria-label="Card actions">
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onEdit && <DropdownMenuItem onSelect={edit}>Edit card</DropdownMenuItem>}
            {onDelete && (
              <DropdownMenuItem variant="destructive" onSelect={remove}>
                Delete card
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
