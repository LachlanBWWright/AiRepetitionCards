import { Button } from "@recall/ui-web";
import { ChatGPTLogo } from "@/components/auth/ChatGPTLogo";
import type { LocalChatGPTState } from "./local-chatgpt-status";

export function ChatGPTSignInPrompt({
  state,
  busy,
  checking,
  onSignIn,
}: {
  readonly state: LocalChatGPTState | null;
  readonly busy: boolean;
  readonly checking: boolean;
  readonly onSignIn: (clientId: string | null, enablePlan: boolean) => void;
}) {
  if (!state?.enabled || checking) return null;
  const account =
    state.accounts.find((item) => item.clientId === state.activeClientId) ?? state.accounts[0];
  if (account?.signedIn && account.planEnabled) return null;
  return (
    <div className="flex flex-col gap-4">
      <Button
        size="lg"
        type="button"
        className="w-full gap-2"
        disabled={busy}
        onClick={() => {
          onSignIn(account?.clientId ?? null, true);
        }}
      >
        <ChatGPTLogo />
        {busy
          ? "Signing in to ChatGPT…"
          : account?.signedIn
            ? "Enable ChatGPT access"
            : "Sign in with ChatGPT"}
      </Button>
      <p className="text-xs text-muted-foreground">
        Opens your browser to sign in. AI requests use your ChatGPT allowance.
      </p>
    </div>
  );
}
