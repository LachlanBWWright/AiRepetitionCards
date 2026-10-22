import type { ChatModelSelection } from "./chat-model-selection";
export type { ChatModelSelection } from "./chat-model-selection";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";

export function ChatModelPicker({
  selection,
  busy,
}: {
  readonly selection?: ChatModelSelection | undefined;
  readonly busy: boolean;
}) {
  if (!selection) return <span className="px-2 text-xs text-muted-foreground">Server model</span>;
  return (
    <Select
      value={selection.value}
      onValueChange={selection.onChange}
      disabled={busy || selection.disabled || selection.models.length === 0}
    >
      <SelectTrigger
        aria-label="Chat model"
        className="h-8 w-auto max-w-[240px] gap-2 border-0 bg-transparent px-2 text-xs shadow-none dark:bg-transparent"
      >
        <SelectValue placeholder="Models unavailable" />
      </SelectTrigger>
      <SelectContent align="start">
        {selection.models.map((model) => (
          <SelectItem key={model.slug} value={model.slug}>
            {model.displayName}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
