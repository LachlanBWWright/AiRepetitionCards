import { ContinueWithChatGPT } from "./ContinueWithChatGPT";

export function ChatGPTIdentityOption({
  enabled,
  next,
  demo,
}: {
  readonly enabled: boolean;
  readonly next: string;
  readonly demo: boolean;
}) {
  if (!enabled) return null;
  return (
    <>
      <div className="flex items-center gap-3 pt-2 text-xs text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
        <span>or</span>
      </div>
      <ContinueWithChatGPT enabled next={next} demo={demo} />
    </>
  );
}
