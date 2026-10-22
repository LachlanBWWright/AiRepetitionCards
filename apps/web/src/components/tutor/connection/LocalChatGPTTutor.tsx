"use client";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import type { TutorTokenUsage } from "@recall/ai-core";
import { selectTutorModel } from "@recall/application";
import { Effect, Either, Schema } from "effect";
import { Button, Dialog } from "@recall/ui-web";
import { readLocalChatGPTConnection } from "./read-local-chatgpt-connection";
import { localTutorUnavailableReason } from "./local-tutor-readiness";
import type { ChatModelSelection } from "../chat/ChatModelPicker";
import { TutorPanel } from "../practice/TutorPanel";
import { TutorPrivacyControls } from "./TutorPrivacyControls";
import { ChatGPTResearchPanel } from "../research/ChatGPTResearchPanel";
import { createLocalChatGptTutor } from "@/lib/chatgpt-local-tutor";
import { tutorApi } from "@/lib/tutor-api";
import { createLocalTutorPrivacyApi } from "@/lib/chatgpt-local-privacy";
import { chatGptPlanFailureMessage } from "@/lib/chatgpt-plan-errors";
import "@/lib/desktop-api";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { ChatGPTPlanControls, Models } from "./LocalChatGPTTutorPlanControls";
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
let welcomeOwner: symbol | null = null;

export { ChatGPTPlanControls } from "./LocalChatGPTTutorPlanControls";
export type { LocalChatGPTState } from "./LocalChatGPTTutorPlanControls";
import type { LocalChatGPTState } from "./LocalChatGPTTutorPlanControls";

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
      <Button variant="outline" type="button" onClick={onDismiss}>
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
            readonly research: ReactNode;
            readonly unavailableReason: string | null;
          },
        ) => ReactNode;
        readonly settingsOnly?: false;
      })
    | { readonly settingsOnly: true },
) {
  const [connectionId] = useState(() => Symbol("ChatGPT connection"));
  useEffect(
    () => () => {
      if (welcomeOwner === connectionId) welcomeOwner = null;
    },
    [connectionId],
  );
  const [state, setState] = useState<LocalChatGPTState | null>(null);
  const [lastUsage, setLastUsage] = useState<{
    readonly profile: string;
    readonly areaId: string;
    readonly usage: TutorTokenUsage;
  } | null>(null);
  const [models, setModels] = useState<typeof Models.Type>([]);
  const { model } = useSyncExternalStore(subscribeSelection, readSelection, () => defaultSelection);
  const [busy, setBusy] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [checking, setChecking] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);
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
  // Desktop has one AI provider. Route to it even while reconnecting or signed out,
  // so requests never silently fall back to the Recall service.
  const isDesktopChatGPT = bridge !== undefined;
  const privacyApi = useMemo(() => createLocalTutorPrivacyApi(profile), [profile]);
  const api = useMemo(
    () => createLocalChatGptTutor(profile, model, areaId, onUsage),
    [profile, model, areaId, onUsage],
  );
  const refresh = useCallback(
    () =>
      Effect.gen(function* () {
        const bridge = window.recallDesktop?.chatgpt;
        if (!bridge) return;
        setChecking(true);
        const snapshot = yield* readLocalChatGPTConnection(bridge, setState).pipe(
          Effect.tapError(() =>
            Effect.sync(() => {
              setState(null);
              setModels([]);
              setModel("");
            }),
          ),
        );
        setState(snapshot.state);
        setModels(snapshot.models);
        setModel((current) => selectTutorModel(snapshot.models, current));
        setMessage(snapshot.message);
        const account = snapshot.state.accounts.find(
          (item) => item.clientId === snapshot.state.activeClientId,
        );
        if (!account?.signedIn || !account.planEnabled || snapshot.message) return;
        const welcomed = yield* Effect.try({
          try: () => volatileStorage.getItem(`recall-chatgpt-welcome:${account.clientId}`),
          catch: () => null,
        });
        if (!welcomed && (welcomeOwner === null || welcomeOwner === connectionId)) {
          welcomeOwner = connectionId;
          setWelcome(account.clientId);
        }
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            setChecking(false);
          }),
        ),
      ),
    [connectionId],
  );
  useEffect(() => {
    Effect.runFork(
      refresh().pipe(
        Effect.catchAll((error) =>
          Effect.sync(() => {
            setMessage(error);
          }),
        ),
      ),
    );
  }, [refresh]);
  useEffect(() => {
    const onPlanStateChanged = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === connectionId) return;
      Effect.runFork(
        refresh().pipe(
          Effect.catchAll((error) =>
            Effect.sync(() => {
              setMessage(error);
            }),
          ),
        ),
      );
    };
    window.addEventListener("recall-chatgpt-plan-state-changed", onPlanStateChanged);
    return () => {
      window.removeEventListener("recall-chatgpt-plan-state-changed", onPlanStateChanged);
    };
  }, [connectionId, refresh]);
  function operate(operation: () => Promise<unknown>, revoking = false) {
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
          new CustomEvent("recall-chatgpt-plan-state-changed", { detail: connectionId }),
        );
        yield* refresh();
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
        Effect.ensuring(
          Effect.sync(() => {
            setBusy(false);
            setSigningOut(false);
          }),
        ),
      ),
    );
  }
  const research =
    !props.settingsOnly &&
    isDesktopChatGPT &&
    profile &&
    model &&
    state?.accounts.some(
      (account) => account.clientId === profile && account.signedIn && account.planEnabled,
    ) ? (
      <ChatGPTResearchPanel
        key={`research:${profile}:${model}:${props.knowledgeArea.id}`}
        expectedClientId={profile}
        model={model}
        areaId={props.knowledgeArea.id}
        disabled={
          busy ||
          Boolean(state.accounts.find((account) => account.clientId === profile)?.usagePaused)
        }
      />
    ) : undefined;
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
    if (!welcome || localWritesBlocked()) return;
    Effect.runSync(
      Effect.try({
        try: () => {
          volatileStorage.setItem(`recall-chatgpt-welcome:${welcome}`, "1");
        },
        catch: () => null,
      }).pipe(Effect.catchAll(() => Effect.void)),
    );
    if (welcomeOwner === connectionId) welcomeOwner = null;
    setWelcome(null);
  };
  const unavailableReason =
    isDesktopChatGPT && checking
      ? "Checking your ChatGPT connection…"
      : localTutorUnavailableReason({
          desktop: isDesktopChatGPT,
          state,
          model,
          error: message,
        });
  return (
    <>
      {props.settingsOnly && !bridge && (
        <Alert role="status">
          <AlertDescription>
            {message ??
              (state
                ? "ChatGPT access is not enabled in this desktop build. No Recall account is required when it is enabled."
                : "Checking ChatGPT connection…")}
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
          message={message}
          onModel={setModel}
          onSignIn={(clientId, enablePlan) => {
            operate(() => bridge.signIn({ clientId, enablePlan }));
          }}
          onSignOut={(id) => {
            operate(() => bridge.signOut(id), true);
          }}
          onReloadModels={reloadModels}
          onResumePlan={(id) => {
            operate(() => bridge.resumePlan(id));
          }}
        />
      )}
      {props.settingsOnly && bridge && profile && (
        <div className="mt-6 border-t pt-5">
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
      {welcome && <ChatGPTPlanWelcome onDismiss={dismissWelcome} />}
      {props.settingsOnly ? null : props.renderContent ? (
        props.renderContent(isDesktopChatGPT ? api : (props.api ?? tutorApi), {
          sessionNamespace: isDesktopChatGPT ? `chatgpt:${profile}` : "hosted",
          research,
          modelSelection: isDesktopChatGPT
            ? {
                models,
                usage: usage?.model === model ? usage : null,
                value: model,
                onChange: setModel,
                disabled: busy || checking || Boolean(unavailableReason),
              }
            : undefined,
          unavailableReason,
        })
      ) : (
        <TutorPanel
          key={isDesktopChatGPT ? `chatgpt:${profile}:${model}` : "hosted"}
          {...props}
          research={research}
          {...(isDesktopChatGPT ? { api, privacyApi, sessionNamespace: `chatgpt:${profile}` } : {})}
        />
      )}
    </>
  );
}

/** Available from settings even with an empty library and no Recall session. */
export function DesktopAISettings() {
  return <LocalChatGPTTutor settingsOnly />;
}
