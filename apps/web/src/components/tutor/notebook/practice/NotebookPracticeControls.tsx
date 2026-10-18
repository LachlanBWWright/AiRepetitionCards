import { Button } from "@recall/ui-web";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import type { KnowledgeNotebookModel } from "../useKnowledgeNotebookModel";
const actionLabels = {
  deeper: "Go deeper",
  explain: "Explain first",
  skip: "Skip this concept",
} as const;
export function NotebookPracticeControls({
  disabled,
  questionDisabled,
  onControl,
}: {
  readonly disabled: boolean;
  readonly questionDisabled: boolean;
  readonly onControl: KnowledgeNotebookModel["control"];
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t pt-4">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="secondary" size="small" disabled={disabled}>
            More options
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {(["deeper", "explain", "skip"] as const).map((action) => (
            <DropdownMenuItem
              key={action}
              disabled={disabled || (action === "explain" && questionDisabled)}
              onSelect={() => {
                onControl(action);
              }}
            >
              {actionLabels[action]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="link"
        size="small"
        disabled={disabled}
        onClick={() => {
          onControl("finish");
        }}
      >
        Finish session
      </Button>
    </div>
  );
}
