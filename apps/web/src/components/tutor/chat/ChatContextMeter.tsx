import { TUTOR_CONTEXT_TOKEN_LIMIT, type TutorTokenUsage } from "@recall/ai-core";
import { Button } from "@recall/ui-web";
import { Popover, PopoverContent, PopoverTrigger } from "@recall/ui-web/components/popover";

export function ChatContextMeter({
  usage,
}: {
  readonly usage?: TutorTokenUsage | null | undefined;
}) {
  const percent = usage
    ? Math.min(100, (usage.inputTokens / TUTOR_CONTEXT_TOKEN_LIMIT) * 100)
    : null;
  const label =
    percent === null ? "—" : `${percent < 1 ? percent.toFixed(1) : Math.round(percent)}%`;
  const count = (value: number | null) =>
    value === null ? "Not reported" : value.toLocaleString();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="small"
          className="h-8 gap-1.5 px-2 text-xs text-muted-foreground"
          aria-label={
            usage
              ? `Context: ${usage.inputTokens.toLocaleString()} of 100,000 tokens in the last request`
              : "Context: 100,000-token limit; no request yet"
          }
        >
          <span
            aria-hidden="true"
            className={`size-3.5 rounded-full border border-current ${percent !== null && percent >= 90 ? "text-amber-400" : ""}`}
            style={{
              background: `conic-gradient(currentColor ${(percent ?? 0) * 3.6}deg, transparent 0)`,
            }}
          />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">Context window</p>
          <span className="text-xs text-muted-foreground">100k tokens</span>
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
              Cached tokens still occupy context. New messages are counted before sending.
            </p>
          </>
        ) : (
          <p className="text-xs leading-5 text-muted-foreground">
            Token usage appears after your first reply. Each request is checked against the
            100,000-token limit before generation.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
