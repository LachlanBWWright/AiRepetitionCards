"use client";
import { useId } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@recall/ui-web";
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
      <AlertDescription className="col-start-1 space-y-3 leading-6">
        <p>
          ChatGPT requests are paused after a usage limit. Check your allowance before retrying.
        </p>
        <Button
          type="button"
          variant="outline"
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
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={modelId}>Model</Label>
        <Button
          type="button"
          variant="link"
          size="icon"
          className="size-8 text-muted-foreground hover:text-foreground"
          aria-label="Refresh models"
          title="Refresh models"
          disabled={disabled || !onReloadModels}
          onClick={onReloadModels}
        >
          <RefreshCw className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <Select value={model} disabled={disabled || models.length === 0} onValueChange={onModel}>
        <SelectTrigger id={modelId} className="w-full">
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
        ? "Reconnect ChatGPT"
        : "Continue with ChatGPT";
  return (
    <section className="space-y-5" aria-label="ChatGPT connection">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">ChatGPT</h2>
          <span className="text-xs text-muted-foreground">{connectionLabel}</span>
        </div>
        <p className="text-sm leading-6 text-muted-foreground">
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
        <div className="space-y-3">
          <Button
            type="button"
            className="min-h-11 w-full"
            disabled={busy || checking}
            onClick={() => {
              onSignIn(account?.clientId ?? null, true);
            }}
          >
            {signInLabel}
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            Opens your browser to sign in. AI requests use your ChatGPT allowance.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {!account?.planEnabled && (
            <Button
              type="button"
              className="min-h-11 w-full"
              disabled={busy}
              onClick={() => {
                onSignIn(account?.clientId ?? null, true);
              }}
            >
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
      {account && (
        <Button
          type="button"
          variant="destructive"
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs">
        {message && (
          <Button
            type="button"
            variant="link"
            className="h-auto p-0 text-xs"
            disabled={busy}
            onClick={onReloadModels}
          >
            Retry connection check
          </Button>
        )}
        <Button asChild variant="outline">
          <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
            View usage and limits in ChatGPT
          </a>
        </Button>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Selected study content is sent to OpenAI when you use AI. You approve suggested cards before
        they are added.
      </p>
    </section>
  );
}
