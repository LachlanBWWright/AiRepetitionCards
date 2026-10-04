"use client";
import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { Effect, Either, Schema } from "effect";
import { Dialog } from "@recall/ui-web";
import { BudgetSettingsPanel } from "../auth/BudgetSettingsPanel";
import { localChatGPTUsageApi } from "@/lib/chatgpt-local-usage";
import { localBudgetFailure } from "@recall/application";
import { TutorPanel } from "./TutorPanel";
import { ChatGPTResearchPanel } from "./ChatGPTResearchPanel";
import { createLocalChatGptTutor } from "@/lib/chatgpt-local-tutor";
import { createLocalTutorPrivacyApi } from "@/lib/chatgpt-local-privacy";
import { chatGptPlanFailureMessage } from "@/lib/chatgpt-plan-errors";
import "@/lib/desktop-api";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";

const desktopBudgetApi = {
  read: (accountId: string) =>
    localChatGPTUsageApi
      .read(accountId)
      .pipe(Effect.mapError((error) => localBudgetFailure(error.message))),
  setBudget: (input: unknown) =>
    localChatGPTUsageApi
      .setBudget(input)
      .pipe(Effect.mapError((error) => localBudgetFailure(error.message))),
};

const Status = Schema.Struct({
  enabled: Schema.Boolean,
  activeClientId: Schema.NullOr(Schema.String),
  accounts: Schema.Array(
    Schema.Struct({
      clientId: Schema.String,
      label: Schema.String,
      email: Schema.NullOr(Schema.String),
      signedIn: Schema.Boolean,
      planEnabled: Schema.Boolean,
      usagePaused: Schema.optional(Schema.Boolean),
    }),
  ),
});
const Models = Schema.Array(Schema.Struct({ slug: Schema.String, displayName: Schema.String }));
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
export type LocalChatGPTState = typeof Status.Type;
export function ChatGPTPlanControls({
  state,
  models,
  model,
  busy = false,
  message,
  usePlan,
  onUsePlan,
  onModel,
  onSignIn,
  onSelect,
  onSignOut,
  onReloadModels,
  onResumePlan,
}: {
  state: LocalChatGPTState;
  models: typeof Models.Type;
  model: string;
  busy?: boolean;
  message?: string | null;
  usePlan: boolean;
  onUsePlan: (value: boolean) => void;
  onModel: (value: string) => void;
  onSignIn: (clientId: string | null, enablePlan: boolean) => void;
  onSelect: (clientId: string) => void;
  onSignOut: (clientId: string) => void;
  onReloadModels?: () => void;
  onResumePlan?: (clientId: string) => void;
}) {
  if (!state.enabled) return null;
  const account = state.accounts.find((item) => item.clientId === state.activeClientId);
  return (
    <section className="tutor-panel" aria-label="ChatGPT plan tutor">
      <p className="eyebrow">DESKTOP · CHATGPT ACCOUNT</p>
      <h2>Your tutor connection</h2>
      <p>
        Connect your ChatGPT account on this device. Enabling plan tutoring sends the selected
        learning area and your answers directly to OpenAI and uses your ChatGPT plan allowance.
      </p>
      <div>
        <button
          type="button"
          className="text-button"
          disabled={busy}
          onClick={() => onSignIn(null, false)}
        >
          Continue with ChatGPT
        </button>
        {account && (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onSignIn(account.clientId, true)}
          >
            Enable ChatGPT plan tutoring
          </button>
        )}
      </div>
      {state.accounts.map((item) => (
        <div key={item.clientId} className="tutor-gap">
          <span>
            {item.label} · {item.email ?? "No email available"}
            {item.clientId === state.activeClientId && " · active"}
            {!item.signedIn && " · signed out"}
          </span>
          <button
            type="button"
            className="text-button"
            disabled={busy || !item.signedIn || item.clientId === state.activeClientId}
            onClick={() => onSelect(item.clientId)}
          >
            Use account
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy || !item.signedIn}
            onClick={() => onSignOut(item.clientId)}
          >
            Sign out and revoke access
          </button>
          {!item.signedIn && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => onSignIn(item.clientId, false)}
            >
              Sign in again
            </button>
          )}
        </div>
      ))}
      <label>
        <input
          type="checkbox"
          checked={usePlan}
          disabled={busy || (!usePlan && (!account?.planEnabled || models.length === 0))}
          onChange={(event) => onUsePlan(event.target.checked)}
        />{" "}
        Use my ChatGPT plan for this tutor
      </label>
      {usePlan && !account?.planEnabled && (
        <p role="status">
          ChatGPT plan remains selected. Reconnect or enable access to continue; hosted tutoring
          requires switching this choice explicitly.
        </p>
      )}
      {account?.usagePaused && (
        <div role="status">
          <p>
            Plan requests are paused after a usage limit. Check your app allowance before retrying.
          </p>
          <a
            className="primary-button"
            href="https://chatgpt.com/settings/usage"
            target="_blank"
            rel="noreferrer"
          >
            Manage usage
          </a>{" "}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => onResumePlan?.(account.clientId)}
          >
            Retry after checking usage
          </button>
        </div>
      )}
      {account?.planEnabled && (
        <div>
          <label htmlFor="chatgpt-tutor-model">
            {usePlan ? "Using ChatGPT plan" : "ChatGPT plan model"}
          </label>
          <select
            id="chatgpt-tutor-model"
            value={model}
            disabled={busy || models.length === 0}
            onChange={(event) => onModel(event.target.value)}
          >
            {models.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.displayName}
              </option>
            ))}
          </select>{" "}
          <button type="button" className="text-button" disabled={busy} onClick={onReloadModels}>
            Reload available models
          </button>{" "}
          <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
            Manage usage
          </a>
        </div>
      )}
      <p>
        Plan tutoring is available only for eligible ChatGPT accounts and supported app usage.{" "}
        <a href="https://help.openai.com/" target="_blank" rel="noreferrer">
          Learn more
        </a>
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function ChatGPTPlanWelcome({ onDismiss }: { onDismiss: () => void }) {
  return (
    <Dialog labelledBy="chatgpt-plan-welcome" onClose={onDismiss}>
      <h2 id="chatgpt-plan-welcome">You’re using your ChatGPT plan</h2>
      <p>
        Eligible AI requests on this device can use your ChatGPT plan allowance when you select plan
        tutoring. Manage this app’s limits in ChatGPT Settings → Usage.
      </p>
      <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
        Manage usage
      </a>
      <button className="text-button" type="button" onClick={onDismiss}>
        Got it
      </button>
    </Dialog>
  );
}
export function LocalChatGPTTutor(props: ComponentProps<typeof TutorPanel>) {
  const [state, setState] = useState<LocalChatGPTState | null>(null);
  const [models, setModels] = useState<typeof Models.Type>([]);
  const [model, setModel] = useState("");
  const [usePlan, setUsePlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);
  const profile = state?.activeClientId ?? "";
  const privacyApi = useMemo(() => createLocalTutorPrivacyApi(profile), [profile]);
  const api = useMemo(
    () => createLocalChatGptTutor(profile, model, props.knowledgeArea.id),
    [profile, model, props.knowledgeArea.id],
  );
  const refresh = () =>
    Effect.gen(function* () {
      const bridge = window.recallDesktop?.chatgpt;
      if (!bridge) return;
      const raw = yield* Effect.tryPromise({
        try: bridge.status,
        catch: () => "ChatGPT account status unavailable.",
      });
      const reply = Schema.decodeUnknownEither(Reply)(raw);
      if (Either.isLeft(reply) || reply.right._tag !== "Success")
        return yield* Effect.fail("ChatGPT account status unavailable.");
      const status = Schema.decodeUnknownEither(Status)(reply.right.value);
      if (Either.isLeft(status)) return yield* Effect.fail("Invalid ChatGPT account status.");
      setState(status.right);
      const account = status.right.accounts.find(
        (item) => item.clientId === status.right.activeClientId,
      );
      if (!account?.planEnabled) {
        setModels([]);
        setModel("");
        return;
      }
      const welcomed = yield* Effect.try({
        try: () => localStorage.getItem(`recall-chatgpt-welcome:${account.clientId}`),
        catch: () => null,
      });
      if (!welcomed) setWelcome(account.clientId);
      setModels([]);
      const catalog = yield* Effect.tryPromise({
        try: bridge.models,
        catch: () => "Model catalog unavailable. Manage usage in ChatGPT and try again.",
      });
      const decoded = Schema.decodeUnknownEither(Reply)(catalog);
      if (Either.isLeft(decoded)) return yield* Effect.fail("Invalid model catalog response.");
      if (decoded.right._tag === "Failure")
        return yield* Effect.fail(chatGptPlanFailureMessage(decoded.right));
      const values = Schema.decodeUnknownEither(Models)(decoded.right.value);
      if (Either.isLeft(values)) return yield* Effect.fail("Invalid model catalog.");
      setModels(values.right);
      setModel((current) =>
        values.right.some((item) => item.slug === current)
          ? current
          : (values.right[0]?.slug ?? ""),
      );
    });
  useEffect(() => {
    Effect.runFork(
      refresh().pipe(Effect.catchAll((error) => Effect.sync(() => setMessage(error)))),
    );
  }, []);
  useEffect(() => {
    const onPlanStateChanged = () =>
      Effect.runFork(
        refresh().pipe(Effect.catchAll((error) => Effect.sync(() => setMessage(error)))),
      );
    window.addEventListener("recall-chatgpt-plan-state-changed", onPlanStateChanged);
    return () =>
      window.removeEventListener("recall-chatgpt-plan-state-changed", onPlanStateChanged);
  }, []);
  function operate(operation: () => Promise<unknown>, revoking = false) {
    setBusy(true);
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
        yield* refresh();
      }).pipe(
        Effect.catchAll((error) => Effect.sync(() => setMessage(error))),
        Effect.ensuring(Effect.sync(() => setBusy(false))),
      ),
    );
  }
  const bridge = typeof window === "undefined" ? undefined : window.recallDesktop?.chatgpt;
  return (
    <>
      {state && bridge && (
        <ChatGPTPlanControls
          state={state}
          models={models}
          model={model}
          busy={busy}
          message={message}
          usePlan={usePlan}
          onUsePlan={setUsePlan}
          onModel={setModel}
          onSignIn={(clientId, enablePlan) =>
            operate(() => bridge.signIn({ clientId, enablePlan }))
          }
          onSelect={(id) => operate(() => bridge.select(id))}
          onSignOut={(id) => operate(() => bridge.signOut(id), true)}
          onReloadModels={() => {
            setBusy(true);
            setMessage(null);
            Effect.runFork(
              refresh().pipe(
                Effect.catchAll((error) => Effect.sync(() => setMessage(error))),
                Effect.ensuring(Effect.sync(() => setBusy(false))),
              ),
            );
          }}
          onResumePlan={(id) => operate(() => bridge.resumePlan(id))}
        />
      )}
      {profile && <BudgetSettingsPanel key={profile} api={desktopBudgetApi} accountId={profile} />}
      {welcome && (
        <ChatGPTPlanWelcome
          onDismiss={() => {
            if (localWritesBlocked()) return;
            Effect.runSync(
              Effect.try({
                try: () => localStorage.setItem(`recall-chatgpt-welcome:${welcome}`, "1"),
                catch: () => null,
              }).pipe(Effect.catchAll(() => Effect.void)),
            );
            setWelcome(null);
          }}
        />
      )}
      {usePlan &&
        state &&
        bridge &&
        profile &&
        model &&
        state.accounts.some(
          (account) => account.clientId === profile && account.signedIn && account.planEnabled,
        ) && (
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
        )}
      <TutorPanel
        key={usePlan ? `chatgpt:${profile}:${model}` : "hosted"}
        {...props}
        {...(usePlan ? { api, privacyApi, sessionNamespace: `chatgpt:${profile}` } : {})}
      />
    </>
  );
}
