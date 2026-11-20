import { NativeSelect } from "@recall/ui-native";
import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";
import type { ChatGPTAuthStatus } from "../../storage/auth/chatgpt-auth";

export type NativeChatGPTConnectionProps = {
  readonly managedStatusMessage?: string | null;
  readonly managedRequestsUsed?: number | undefined;
  readonly managedRequestLimit?: number | undefined;
  readonly refreshManagedAccess?: () => void;
  readonly tutorMode?: "chatgpt" | "hosted";
  readonly setTutorMode?: (mode: "chatgpt" | "hosted") => void;
  readonly models?: readonly { readonly slug: string; readonly display_name: string }[];
  readonly model?: string;
  readonly setModel?: (model: string) => void;
  readonly modelsBusy?: boolean;
  readonly modelsMessage?: string | null;
  readonly refreshModels?: () => void;
  readonly ready: boolean;
  readonly available: boolean;
  readonly status: ChatGPTAuthStatus;
  readonly busy: boolean;
  readonly signingIn: boolean;
  readonly message: string | null;
  readonly signIn: (clientId: string | null, enablePlan?: boolean) => void;
  readonly cancel: () => void;
  readonly signOut: (clientId: string) => void;
  readonly manageUsage: () => void;
};

function ChatGPTAccountCard({
  account,
  busy,
  signIn,
  signOut,
}: {
  readonly account: ChatGPTAuthStatus["accounts"][number];
  readonly busy: boolean;
  readonly signIn: NativeChatGPTConnectionProps["signIn"];
  readonly signOut: NativeChatGPTConnectionProps["signOut"];
}) {
  const status = !account.signedIn
    ? "Signed out"
    : account.planEnabled
      ? "ChatGPT plan access approved"
      : "Signed in · plan access not approved";
  return (
    <View className="gap-4 rounded-xl border border-recall-line p-4">
      <Text className="text-recall-ink font-bold">ChatGPT account</Text>
      {account.email && <Text>{account.email}</Text>}
      <Text>{status}</Text>
      {account.signedIn ? (
        <>
          {!account.planEnabled && (
            <NativeButton
              label="Enable ChatGPT access"
              variant="default"
              disabled={busy}
              onPress={() => {
                signIn(account.clientId, true);
              }}
            />
          )}
          <NativeButton
            label="Sign out of ChatGPT"
            variant="default"
            disabled={busy}
            onPress={() => {
              signOut(account.clientId);
            }}
          />
        </>
      ) : null}
    </View>
  );
}
export function NativeChatGPTConnection(props: NativeChatGPTConnectionProps) {
  const account =
    props.status.accounts.find((item) => item.clientId === props.status.activeClientId) ??
    props.status.accounts[0];
  return (
    <View className="gap-4 border-t border-recall-line py-6" accessibilityLabel="AI connection">
      <Text className="text-recall-ink text-[15px] font-bold">ChatGPT connection</Text>
      <Text className="text-recall-muted text-[12px]">
        Connect ChatGPT separately for AI access. No Recall account is required. Approving plan
        access allows AI requests to use your ChatGPT allowance and send selected learning content
        to OpenAI. Recall sign-in and cloud sync stay separate.
      </Text>
      <Text className="text-recall-muted text-[12px]">
        ChatGPT tutoring uses the selected model directly from this device. Hosted tutoring uses
        Recall’s server and requires a Recall account. Failed requests never switch providers.
      </Text>
      {props.setTutorMode && (
        <NativeSelect
          label="Tutor provider"
          value={props.tutorMode ?? "chatgpt"}
          options={[
            { label: "ChatGPT plan", value: "chatgpt" },
            { label: "Recall managed AI", value: "hosted" },
          ]}
          onValueChange={(value) => {
            if (value === "chatgpt" || value === "hosted") props.setTutorMode?.(value);
          }}
          disabled={props.busy}
        />
      )}
      {props.tutorMode !== "hosted" && props.managedStatusMessage && (
        <Text className="text-sm text-recall-muted">{props.managedStatusMessage}</Text>
      )}
      {props.tutorMode === "hosted" && (
        <View className="gap-3">
          <Text>
            Managed AI uses your Recall allowance and sends selected study content to Recall’s
            configured provider.
          </Text>
          {props.managedStatusMessage && (
            <Text accessibilityRole="alert">{props.managedStatusMessage}</Text>
          )}
          {props.managedRequestLimit !== undefined && (
            <Text>
              Today: {props.managedRequestsUsed ?? 0} of {props.managedRequestLimit} managed
              requests used.
            </Text>
          )}
          {props.refreshManagedAccess && (
            <NativeButton
              label="Refresh managed allowance"
              variant="secondary"
              onPress={props.refreshManagedAccess}
            />
          )}
        </View>
      )}
      {props.tutorMode === "chatgpt" && props.setModel && (props.models?.length ?? 0) > 0 && (
        <NativeSelect
          label="ChatGPT model"
          value={props.model ?? ""}
          options={(props.models ?? []).map((item) => ({
            label: item.display_name,
            value: item.slug,
          }))}
          onValueChange={props.setModel}
          disabled={props.busy || (props.modelsBusy ?? false)}
        />
      )}
      {props.modelsBusy && <Text>Loading ChatGPT models…</Text>}
      {props.modelsMessage && <Text accessibilityRole="alert">{props.modelsMessage}</Text>}
      {account?.planEnabled && props.refreshModels && (
        <NativeButton
          variant="default"
          label="Refresh ChatGPT models"
          disabled={props.busy || (props.modelsBusy ?? false)}
          onPress={props.refreshModels}
        />
      )}
      {!props.ready ? (
        <Text>Checking ChatGPT connection…</Text>
      ) : !props.available ? (
        <Text>ChatGPT sign-in requires a rebuilt native app and is unavailable in Expo Go.</Text>
      ) : (
        <>
          {!account?.signedIn && (
            <NativeButton
              label={props.signingIn ? "Waiting for ChatGPT…" : "Continue with ChatGPT"}
              disabled={props.busy}
              onPress={() => {
                props.signIn(account?.clientId ?? null);
              }}
            />
          )}
          {props.signingIn && (
            <NativeButton
              variant="secondary"
              label="Cancel ChatGPT sign-in"
              onPress={props.cancel}
            />
          )}
          {account && (
            <ChatGPTAccountCard
              account={account}
              busy={props.busy}
              signIn={props.signIn}
              signOut={props.signOut}
            />
          )}
          <NativeButton
            label="Manage ChatGPT usage"
            variant="default"
            disabled={props.busy}
            onPress={props.manageUsage}
          />
        </>
      )}
      {props.message && <Text accessibilityRole="alert">{props.message}</Text>}
    </View>
  );
}
