import type { ComponentProps } from "react";
import { Alert } from "react-native";
import { Effect, Either } from "effect";
import { signInNativeWithGoogle, supabaseAuthClient } from "../../storage/auth/supabase-auth";
import { NativeAccountPanel } from "./NativeAccountPanel";
import { NativeBudgetSettingsPanel } from "./NativeBudgetSettingsPanel";
import { NativeChatGPTConnection } from "./NativeChatGPTConnection";
import { NativeDailyReminderSettingsPanel } from "./NativeDailyReminderSettingsPanel";

type NativeAccountPanelProps = ComponentProps<typeof NativeAccountPanel>;

export function NativeAccountTab({
  chatGPT,
  dailyReminders,
  accountUserId,
  cloudAvailable,
  account,
  accountPanel,
  ownershipIssue,
  onResetWorkspace,
}: {
  readonly chatGPT: ComponentProps<typeof NativeChatGPTConnection>;
  readonly dailyReminders: ComponentProps<typeof NativeDailyReminderSettingsPanel>["controller"];
  readonly accountUserId: string | null;
  readonly cloudAvailable: boolean;
  readonly account: string | null;
  readonly accountPanel: Omit<
    NativeAccountPanelProps,
    | "cloudAvailable"
    | "account"
    | "onRequestSignIn"
    | "onSignOut"
    | "ownershipIssue"
    | "onResetForAccount"
  >;
  readonly ownershipIssue: "account-mismatch" | "owner-adoption-required" | null;
  readonly onResetWorkspace: () => void;
}) {
  return (
    <>
      <NativeChatGPTConnection {...chatGPT} />
      <NativeDailyReminderSettingsPanel controller={dailyReminders} />
      {accountUserId && (
        <NativeBudgetSettingsPanel key={accountUserId} accountId={`hosted:${accountUserId}`} />
      )}
      <NativeAccountPanel
        {...accountPanel}
        cloudAvailable={cloudAvailable}
        account={account}
        ownershipIssue={ownershipIssue}
        onRequestSignIn={async () => {
          const result = await Effect.runPromise(Effect.either(signInNativeWithGoogle()));
          return Either.isRight(result) && result.right
            ? "Complete Google sign-in in your browser, then return to Recall."
            : "Google sign-in could not start. Please try again.";
        }}
        onSignOut={async () => {
          const client = supabaseAuthClient;
          if (!client) return "Cloud sign-out is unavailable on this device.";
          const result = await Effect.runPromise(
            Effect.either(
              Effect.tryPromise({
                try: () => client.auth.signOut(),
                catch: () => ({ _tag: "SignOutRequestError" }) as const,
              }),
            ),
          );
          return Either.isRight(result) && !result.right.error
            ? "Signed out. This device’s local study data remains available."
            : "Could not sign out. Your current account session is unchanged.";
        }}
        onResetForAccount={() => {
          Alert.alert(
            "Start a fresh workspace?",
            "Export a private backup first. Resetting removes this device’s saved workspace and attachments; cloud data is unchanged.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Reset local workspace",
                style: "destructive",
                onPress: onResetWorkspace,
              },
            ],
          );
        }}
      />
    </>
  );
}
