"use client";
import { ChatGPTLogo } from "@/components/auth/ChatGPTLogo";
import { useId } from "react";
import { RefreshCw } from "lucide-react";
import { Button, Tooltip, TooltipContent, TooltipTrigger } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import { Alert, AlertDescription } from "@recall/ui-web/components/alert";

export { Status, Models } from "./local-chatgpt-status";
export type { LocalChatGPTState } from "./local-chatgpt-status";
import { Models, type LocalChatGPTState } from "./local-chatgpt-status";
type ChatGPTAccount = LocalChatGPTState["accounts"][number];
type ChatGPTModel = (typeof Models.Type)[number];

function UsagePausedNotice({
  account,
  busy,
  onResumePlan,
}: {
  readonly account: ChatGPTAccount;
  readonly busy: boolean;
  readonly onResumePlan?: ((clientId: string) => void) | undefined;
}) {
  return (
    <Alert role="status">
      <AlertDescription className="col-start-1 flex flex-col gap-4 leading-6">
        <p>
          ChatGPT requests are paused after a usage limit. Check your allowance before retrying.
        </p>
        <Button
          type="button"
          variant="default"
          className="w-full"
          disabled={busy}
          onClick={() => onResumePlan?.(account.clientId)}
        >
          Retry after checking usage
        </Button>
      </AlertDescription>
    </Alert>
  );
}

function ModelSelector({
  models,
  model,
  disabled,
  onModel,
  onReloadModels,
}: {
  readonly models: readonly ChatGPTModel[];
  readonly model: string;
  readonly disabled: boolean;
  readonly onModel: (value: string) => void;
  readonly onReloadModels?: (() => void) | undefined;
}) {
  const modelId = useId();
  return (
    <div className="grid min-w-0 gap-2">
      <Label htmlFor={modelId}>Model</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Select value={model} disabled={disabled || models.length === 0} onValueChange={onModel}>
          <SelectTrigger size="lg" id={modelId} className="h-10 min-w-0 flex-1">
            <SelectValue placeholder="Models unavailable" />
          </SelectTrigger>
          <SelectContent>
            {models.map((item) => (
              <SelectItem key={item.slug} value={item.slug}>
                {item.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="shrink-0"
              aria-label="Refresh models"
              disabled={disabled || !onReloadModels}
              onClick={onReloadModels}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh models</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
export function ChatGPTPlanControls({
  state,
  models,
  model,
  busy = false,
  signingOut = false,
  checking = false,
  message,
  onModel,
  onSignIn,
  onSignOut,
  onReloadModels,
  onResumePlan,
}: {
  state: LocalChatGPTState;
  models: typeof Models.Type;
  model: string;
  busy?: boolean;
  signingOut?: boolean;
  checking?: boolean;
  message?: string | null;
  onModel: (value: string) => void;
  onSignIn: (clientId: string | null, enablePlan: boolean) => void;
  onSignOut: (clientId: string) => void;
  onReloadModels?: () => void;
  onResumePlan?: (clientId: string) => void;
}) {
  if (!state.enabled) return null;
  const account =
    state.accounts.find((item) => item.clientId === state.activeClientId) ?? state.accounts[0];
  const connected = Boolean(account?.signedIn);
  const ready = connected && account?.planEnabled && models.some((item) => item.slug === model);
  const connectionLabel = signingOut
    ? "Signing out…"
    : checking
      ? "Checking…"
      : ready
        ? "Ready"
        : connected
          ? "Needs attention"
          : account
            ? "Reconnect required"
            : "Not connected";
  const signInLabel = checking
    ? "Checking connection…"
    : busy
      ? "Connecting to ChatGPT…"
      : account
        ? "Sign in with ChatGPT"
        : "Sign in with ChatGPT";
  return (
    <section
      className="flex w-full max-w-3xl min-w-0 flex-col gap-4"
      aria-label="ChatGPT connection"
    >
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">ChatGPT</h2>
          <span className="text-xs text-muted-foreground">{connectionLabel}</span>
        </div>
        <p className="break-words text-sm leading-6 text-muted-foreground">
          {account
            ? (account.email ?? account.label)
            : "Use your ChatGPT plan for tutoring and research. No Recall account needed."}
        </p>
      </div>
      {message && (
        <Alert role="status" className="text-left">
          <AlertDescription className="col-start-1 leading-6">{message}</AlertDescription>
        </Alert>
      )}
      {!connected ? (
        <div className="flex flex-col gap-4">
          <Button
            type="button"
            className="w-full"
            disabled={busy || checking}
            onClick={() => {
              onSignIn(account?.clientId ?? null, true);
            }}
          >
            <ChatGPTLogo />
            {signInLabel}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Opens your browser to sign in. AI requests use your ChatGPT allowance.
          </p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {!account?.planEnabled && (
            <Button
              type="button"
              className="w-full"
              disabled={busy}
              onClick={() => {
                onSignIn(account?.clientId ?? null, true);
              }}
            >
              <ChatGPTLogo />
              Enable ChatGPT access
            </Button>
          )}
          {account?.planEnabled && (
            <>
              <ModelSelector
                models={models}
                model={model}
                disabled={busy || checking}
                onModel={onModel}
                onReloadModels={onReloadModels}
              />
            </>
          )}
          {account?.usagePaused && (
            <UsagePausedNotice account={account} busy={busy} onResumePlan={onResumePlan} />
          )}
        </div>
      )}
      <div className="flex flex-col gap-4">
        {message && (
          <Button
            type="button"
            variant="default"
            className="w-full"
            disabled={busy}
            onClick={onReloadModels}
          >
            Retry connection check
          </Button>
        )}
        <a
          className="text-sm text-primary underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          href="https://chatgpt.com/settings/usage"
          target="_blank"
          rel="noreferrer"
        >
          View usage and limits in ChatGPT
        </a>
      </div>
      {account && (
        <Button
          type="button"
          variant="default"
          className="w-full"
          disabled={busy}
          onClick={() => {
            onSignOut(account.clientId);
          }}
        >
          {signingOut
            ? "Signing out…"
            : connected
              ? "Sign out of ChatGPT"
              : "Remove ChatGPT connection"}
        </Button>
      )}
      <p className="text-xs leading-5 text-muted-foreground">
        Selected study content is sent to OpenAI when you use AI. You approve suggested cards before
        they are added.
      </p>
    </section>
  );
}
