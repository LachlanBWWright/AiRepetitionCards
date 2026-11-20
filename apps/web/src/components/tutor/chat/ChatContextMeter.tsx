import { TUTOR_CONTEXT_TOKEN_LIMIT, type TutorTokenUsage } from "@recall/ai-core";
import { Button } from "@recall/ui-web";
import { Popover, PopoverContent, PopoverTrigger } from "@recall/ui-web/components/popover";

export function ChatContextMeter({
  usage,
}: {
  readonly usage?: TutorTokenUsage | null | undefined;
}) {
  const percent =
    usage?.inputTokens != null
      ? Math.min(100, (usage.inputTokens / TUTOR_CONTEXT_TOKEN_LIMIT) * 100)
      : null;
  const label =
    percent === null ? "—" : `${percent < 1 ? percent.toFixed(1) : String(Math.round(percent))}%`;
  const count = (value: number | null) =>
    value === null ? "Not reported" : value.toLocaleString();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          aria-label={
            usage?.inputTokens != null
              ? `Last request: ${usage.inputTokens.toLocaleString()} input tokens`
              : "Input token usage not reported"
          }
        >
          <span
            aria-hidden="true"
            className="size-3.5 rounded-full border border-current"
            style={{
              background: `conic-gradient(currentColor ${String((percent ?? 0) * 3.6)}deg, transparent 0)`,
            }}
          />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">Context window</p>
          <span className="text-xs text-muted-foreground">100k reference</span>
        </div>
        {usage ? (
          <>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Last request input</dt>
              <dd className="text-right">{count(usage.inputTokens)}</dd>
              <dt className="text-muted-foreground">Response tokens</dt>
              <dd className="text-right">{count(usage.outputTokens)}</dd>
              <dt className="text-muted-foreground">Cache read</dt>
              <dd className="text-right">{count(usage.cachedInputTokens)}</dd>
              <dt className="text-muted-foreground">Cache write</dt>
              <dd className="text-right">{count(usage.cacheWriteTokens)}</dd>
            </dl>
            <p className="text-xs leading-5 text-muted-foreground">
              Measured usage for the last request, including instructions, deck and conversation.
              Cached tokens still occupy context. The chart uses 100,000 tokens as a reference; the
              selected model determines the context limit.
            </p>
          </>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            Token usage appears after your first reply when reported by the provider.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
