import type { LearningArea } from "@recall/domain";
import { summarizeStudySession } from "@recall/application";
import { Button } from "@recall/ui-web/components/button";
import { ChevronRight, Ellipsis, Pencil, Settings, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";

export function DeckOverviewRow({
  area,
  now,
  onOpen,
  onEdit,
  onSettings,
  onDelete,
  disabled,
}: {
  readonly area: LearningArea;
  readonly now: number;
  readonly onOpen: (id: string) => void;
  readonly onEdit?: (area: LearningArea) => void;
  readonly onSettings?: (area: LearningArea) => void;
  readonly onDelete?: (area: LearningArea) => void;
  readonly disabled: boolean;
}) {
  const summary = summarizeStudySession(area, [], now);
  return (
    <li className="flex items-center gap-2 py-2">
      <Button
        size="row"
        variant="default"
        className="group min-w-0 flex-1 justify-start gap-4 text-left"
        disabled={disabled}
        onClick={() => {
          onOpen(area.id);
        }}
        aria-label={`Open ${area.title}`}
      >
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: area.color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 space-y-1 whitespace-normal">
          <span className="text-base block break-words font-semibold">{area.title}</span>
          <span className="text-sm block font-normal">
            {area.cards.length} {area.cards.length === 1 ? "card" : "cards"}
          </span>
        </span>
        <span className="text-sm shrink-0 font-normal">
          {summary.remaining > 0 ? `${String(summary.remaining)} due` : "Nothing due"}
        </span>
        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
      </Button>
      <DeckOverviewActions
        area={area}
        {...(onEdit ? { onEdit } : {})}
        {...(onSettings ? { onSettings } : {})}
        {...(onDelete ? { onDelete } : {})}
        disabled={disabled}
      />
    </li>
  );
}

function DeckOverviewActions({
  area,
  onEdit,
  onSettings,
  onDelete,
  disabled,
}: {
  readonly area: LearningArea;
  readonly onEdit?: (area: LearningArea) => void;
  readonly onSettings?: (area: LearningArea) => void;
  readonly onDelete?: (area: LearningArea) => void;
  readonly disabled: boolean;
}) {
  if (!onEdit && !onSettings && !onDelete) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="default"
          size="sm"
          className="shrink-0 gap-2"
          disabled={disabled}
          aria-label={`Manage ${area.title}`}
        >
          <Ellipsis className="size-4" aria-hidden="true" />
          <span className="hidden sm:inline">Manage</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onEdit && (
          <DropdownMenuItem
            onSelect={() => {
              onEdit(area);
            }}
          >
            <Pencil aria-hidden="true" />
            Edit deck
          </DropdownMenuItem>
        )}
        {onSettings && (
          <DropdownMenuItem
            onSelect={() => {
              onSettings(area);
            }}
          >
            <Settings aria-hidden="true" />
            Deck settings
          </DropdownMenuItem>
        )}
        {onDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                onDelete(area);
              }}
            >
              <Trash2 aria-hidden="true" />
              Delete deck
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
