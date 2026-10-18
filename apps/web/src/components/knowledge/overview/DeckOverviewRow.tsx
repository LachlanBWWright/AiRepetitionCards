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
    <li className="flex items-center">
      <Button
        variant="link"
        className="group h-auto min-w-0 flex-1 justify-start gap-4 rounded-none px-4 py-5 text-left text-foreground no-underline hover:bg-accent/40 hover:no-underline sm:px-5"
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
          <span className="block break-words text-base font-semibold">{area.title}</span>
          <span className="block text-sm font-normal text-muted-foreground">
            {area.cards.length} {area.cards.length === 1 ? "card" : "cards"}
          </span>
        </span>
        <span className="shrink-0 text-sm font-normal text-muted-foreground">
          {summary.remaining > 0 ? `${String(summary.remaining)} due` : "Nothing due"}
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
          variant="outline"
          size="sm"
          className="mr-4 shrink-0 gap-2"
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
