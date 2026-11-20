"use client";
import {
  useCallback,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { TutorTokenUsage } from "@recall/ai-core";
import { Effect, Either, Schema } from "effect";
import { Button, Dialog } from "@recall/ui-web";
import { useBrowserAiFunding } from "../funding/AiFundingProvider";
import { AiFundingSettings } from "../funding/AiFundingSettings";
import { useLocalChatGPTConnection } from "./LocalChatGPTConnectionProvider";
import { ChatGPTSignInPrompt } from "./ChatGPTSignInPrompt";
import { localTutorUnavailableReason } from "./local-tutor-readiness";
import type { ChatModelSelection } from "../chat/ChatModelPicker";
import { TutorPanel } from "../practice/TutorPanel";
import { TutorPrivacyControls } from "./TutorPrivacyControls";
import { createLocalChatGptTutor } from "@/lib/chatgpt-local-tutor";
import { tutorApi, createManagedTutorApi } from "@/lib/tutor-api";
import { createLocalTutorPrivacyApi } from "@/lib/chatgpt-local-privacy";
import { chatGptPlanFailureMessage } from "@/lib/chatgpt-plan-errors";
import "@/lib/desktop-api";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { ChatGPTPlanControls } from "./LocalChatGPTTutorPlanControls";
const Reply = Schema.Union(
  Schema.Struct({ _tag: Schema.Literal("Success"), value: Schema.Unknown }),
  Schema.Struct({
    _tag: Schema.Literal("Failure"),
    code: Schema.String,
    status: Schema.optionalWith(Schema.Number.pipe(Schema.int(), Schema.between(100, 599)), {
      exact: true,
    }),
    recovery: Schema.optionalWith(Schema.String, { exact: true }),
  }),
);
import {
  defaultSelection,
  subscribeSelection,
  readSelection,
  setModel,
} from "./chat-model-selection";

export { ChatGPTPlanControls } from "./LocalChatGPTTutorPlanControls";
export type { LocalChatGPTState } from "./LocalChatGPTTutorPlanControls";

export function ChatGPTPlanWelcome({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Dialog labelledBy="chatgpt-plan-welcome" onClose={onDismiss}>
      <h2 className="text-lg font-semibold" id="chatgpt-plan-welcome">
        ChatGPT connected
      </h2>
      <p>AI requests use your ChatGPT allowance. You can change the connection in AI settings.</p>
      <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
        Manage usage
      </a>
      <Button variant="default" type="button" onClick={onDismiss}>
        Got it
      </Button>
    </Dialog>
  );
}
export function LocalChatGPTTutor(
  props:
    | (ComponentProps<typeof TutorPanel> & {
        readonly renderContent?: (
          api: typeof tutorApi,
          context: {
            readonly modelSelection?: ChatModelSelection | undefined;
            readonly sessionNamespace: string;
            readonly unavailableReason: string | null;
            readonly connectionPrompt: ReactNode;
          },
        ) => ReactNode;
        readonly settingsOnly?: false;
      })
    | { readonly settingsOnly: true },
) {
  const funding = useBrowserAiFunding();
  const {
    state,
    models,
    checking,
    message: connectionMessage,
    store: connection,
  } = useLocalChatGPTConnection();
  const [lastUsage, setLastUsage] = useState<{
    readonly profile: string;
    readonly areaId: string;
    readonly usage: TutorTokenUsage;
  } | null>(null);
  const { model } = useSyncExternalStore(subscribeSelection, readSelection, () => defaultSelection);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [welcome, setWelcome] = useState(false);
  const statusMessage = message ?? connectionMessage;
  const profile = state?.activeClientId ?? "";
  const areaId = props.settingsOnly ? "" : props.knowledgeArea.id;
  const onUsage = useCallback(
    (usage: TutorTokenUsage) => {
      setLastUsage({ profile, areaId, usage });
    },
    [profile, areaId],
  );
  const usage =
    lastUsage?.profile === profile && lastUsage.areaId === areaId && lastUsage.usage.model === model
      ? lastUsage.usage
      : null;
  const bridge = typeof window === "undefined" ? undefined : window.recallDesktop?.chatgpt;
  const isDesktopChatGPT = bridge !== undefined && funding?.mode !== "managed";
  const managedApi = useMemo(() => createManagedTutorApi(funding?.owner ?? null), [funding?.owner]);
  const namespace = isDesktopChatGPT
    ? `chatgpt:${profile}`
    : `managed:${funding?.owner ?? "disconnected"}`;
  const privacyApi = useMemo(() => createLocalTutorPrivacyApi(profile), [profile]);
  const api = useMemo(
    () => createLocalChatGptTutor(profile, model, areaId, onUsage),
    [profile, model, areaId, onUsage],
  );
  const refresh = () => (bridge ? connection.refresh(bridge) : Effect.void);
  function operate(
    operation: () => Promise<unknown>,
    {
      revoking = false,
      welcome: showWelcome = false,
    }: {
      readonly revoking?: boolean;
      readonly welcome?: boolean;
    } = {},
  ) {
    connection.invalidate();
    setBusy(true);
    setSigningOut(revoking);
    setMessage(null);
    Effect.runFork(
      Effect.gen(function* () {
        const raw = yield* Effect.tryPromise({
          try: operation,
          catch: () => "ChatGPT account action failed.",
        });
        const reply = Schema.decodeUnknownEither(Reply)(raw);
        if (Either.isLeft(reply)) return yield* Effect.fail("Invalid account response.");
        if (reply.right._tag === "Failure")
          return yield* Effect.fail(
            reply.right.code === "secure-storage-unavailable"
              ? "Secure credential storage is unavailable on this device."
              : chatGptPlanFailureMessage(reply.right),
          );
        window.dispatchEvent(
          new CustomEvent("recall-chatgpt-plan-state-changed", { detail: connection }),
        );
        if (bridge) yield* connection.ensure(bridge);
        const restored = connection.getSnapshot();
        const account = restored.state?.accounts.find(
          (item) => item.clientId === restored.state?.activeClientId,
        );
        if (showWelcome && account?.signedIn && account.planEnabled && !restored.message)
          setWelcome(true);
        if (revoking) {
          const result = Schema.decodeUnknownEither(
            Schema.Struct({ remoteRevocationConfirmed: Schema.Boolean }),
          )(reply.right.value);
          setMessage(
            Either.isRight(result) && result.right.remoteRevocationConfirmed
              ? "Signed out. Access revoked."
              : "Signed out on this device. Remote revocation could not be confirmed; revoke app access in ChatGPT settings.",
          );
        }
      }).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            setMessage(error);
          }),
        ),
        Effect.ensuring(bridge ? connection.ensure(bridge).pipe(Effect.ignore) : Effect.void),
        Effect.ensuring(
          Effect.sync(() => {
            setBusy(false);
            setSigningOut(false);
          }),
        ),
      ),
    );
  }
  const reloadModels = () => {
    setBusy(true);
    setMessage(null);
    Effect.runFork(
      refresh().pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            setMessage(error);
          }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            setBusy(false);
          }),
        ),
      ),
    );
  };
  const notifyHistoryCleared = () => {
    window.dispatchEvent(
      new CustomEvent("recall-tutor-history-cleared", { detail: `chatgpt:${profile}` }),
    );
  };
  const dismissWelcome = () => {
    setWelcome(false);
  };
  const unavailableReason = !isDesktopChatGPT
    ? funding?.mode === "managed"
      ? funding.unavailableReason
      : "Choose Recall managed AI in Account → AI settings to begin."
    : checking
      ? "Checking your ChatGPT connection…"
      : localTutorUnavailableReason({
          desktop: isDesktopChatGPT,
          state,
          model,
          error: statusMessage,
        });
  const modelSelection = isDesktopChatGPT
    ? {
        models,
        usage: usage?.model === model ? usage : null,
        value: model,
        onChange: setModel,
        disabled: busy || checking || Boolean(unavailableReason),
      }
    : undefined;
  const connectionPrompt =
    bridge && isDesktopChatGPT ? (
      <ChatGPTSignInPrompt
        state={state}
        busy={busy}
        checking={checking}
        onSignIn={(clientId, enablePlan) => {
          operate(() => bridge.signIn({ clientId, enablePlan }), { welcome: true });
        }}
      />
    ) : null;
  return (
    <>
      {props.settingsOnly && <AiFundingSettings />}
      {props.settingsOnly && !bridge && (
        <Alert role="status">
          <AlertDescription>
            {statusMessage ??
              (state
                ? "ChatGPT access is not enabled in this desktop build. No Recall account is required when it is enabled."
                : "ChatGPT access is not enabled in this build.")}
          </AlertDescription>
        </Alert>
      )}
      {props.settingsOnly && bridge && (
        <ChatGPTPlanControls
          state={state ?? { enabled: true, activeClientId: null, accounts: [] }}
          models={models}
          model={model}
          busy={busy}
          signingOut={signingOut}
          checking={checking}
          message={statusMessage}
          onModel={setModel}
          onSignIn={(clientId, enablePlan) => {
            operate(() => bridge.signIn({ clientId, enablePlan }), { welcome: true });
          }}
          onSignOut={(id) => {
            operate(() => bridge.signOut(id), { revoking: true });
          }}
          onReloadModels={reloadModels}
          onResumePlan={(id) => {
            operate(() => bridge.resumePlan(id));
          }}
        />
      )}
      {props.settingsOnly && bridge && profile && (
        <div className="border-t pt-6">
          <TutorPrivacyControls
            key={profile}
            api={privacyApi}
            local
            disabled={busy}
            onBusyChange={setBusy}
            onCleared={notifyHistoryCleared}
          />
        </div>
      )}
      {props.settingsOnly && funding?.mode === "managed" && funding.owner && (
        <TutorPrivacyControls
          key={`managed:${funding.owner}`}
          disabled={busy}
          onBusyChange={setBusy}
          onCleared={() => {
            window.dispatchEvent(
              new CustomEvent("recall-tutor-history-cleared", { detail: namespace }),
            );
          }}
        />
      )}
      {welcome && <ChatGPTPlanWelcome onDismiss={dismissWelcome} />}
      {props.settingsOnly ? null : props.renderContent ? (
        <div key={namespace} className="flex min-h-0 flex-1 flex-col">
          {props.renderContent(isDesktopChatGPT ? api : (props.api ?? managedApi), {
            sessionNamespace: namespace,
            modelSelection,
            unavailableReason,
            connectionPrompt,
          })}
        </div>
      ) : (
        <TutorPanel
          key={`${namespace}:${model}`}
          {...props}
          api={isDesktopChatGPT ? api : (props.api ?? managedApi)}
          sessionNamespace={namespace}
          {...(isDesktopChatGPT ? { privacyApi } : {})}
        />
      )}
    </>
  );
}

/** Available from settings even with an empty library and no Recall session. */
export function DesktopAISettings() {
  return <LocalChatGPTTutor settingsOnly />;
}
