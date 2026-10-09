"use client";
import { useEffect, useMemo, useState, type ComponentProps, type ReactNode } from "react";
import { Effect, Either, Schema } from "effect";
import { Button, Dialog } from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import { Checkbox } from "@recall/ui-web/components/checkbox";
import { NativeSelect } from "@recall/ui-web/components/native-select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { BudgetSettingsPanel } from "../auth/BudgetSettingsPanel";
import { localChatGPTUsageApi } from "@/lib/chatgpt-local-usage";
import { localBudgetFailure } from "@recall/application";
import { TutorPanel } from "./TutorPanel";
import { ChatGPTResearchPanel } from "./ChatGPTResearchPanel";
import { createLocalChatGptTutor } from "@/lib/chatgpt-local-tutor";
import { tutorApi } from "@/lib/tutor-api";
import { createLocalTutorPrivacyApi } from "@/lib/chatgpt-local-privacy";
import { chatGptPlanFailureMessage } from "@/lib/chatgpt-plan-errors";
import "@/lib/desktop-api";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
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
  initialExpanded = false,
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
  readonly initialExpanded?: boolean;
}) {
  if (!state.enabled) return null;
  const account = state.accounts.find((item) => item.clientId === state.activeClientId);
  return (
    <Collapsible
      className="space-y-4 py-4"
      aria-label="ChatGPT plan tutor"
      open={initialExpanded || Boolean(message) || Boolean(account?.usagePaused)}
    >
      <CollapsibleTrigger className="w-full text-left font-medium">
        AI connection{account?.signedIn ? ` · ${account.email ?? account.label}` : ""}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <h2 className="text-lg font-semibold">ChatGPT connection</h2>
        <p>
          Using ChatGPT sends the selected topic, your answers and requested source passages to
          OpenAI. Requests use your ChatGPT allowance.
        </p>
        <div>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onSignIn(null, false)}
          >
            Continue with ChatGPT
          </Button>
          {account && (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onSignIn(account.clientId, true)}
            >
              Enable ChatGPT access
            </Button>
          )}
        </div>
        {state.accounts.map((item) => (
          <div key={item.clientId} className="flex flex-wrap items-center gap-3">
            <span>
              {item.label} · {item.email ?? "No email available"}
              {item.clientId === state.activeClientId && " · active"}
              {!item.signedIn && " · signed out"}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !item.signedIn || item.clientId === state.activeClientId}
              onClick={() => onSelect(item.clientId)}
            >
              Use account
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !item.signedIn}
              onClick={() => onSignOut(item.clientId)}
            >
              Sign out
            </Button>
            {!item.signedIn && (
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => onSignIn(item.clientId, false)}
              >
                Sign in again
              </Button>
            )}
          </div>
        ))}
        <Label>
          <Checkbox
            checked={usePlan}
            disabled={busy || (!usePlan && (!account?.planEnabled || models.length === 0))}
            onCheckedChange={(checked) => onUsePlan(checked === true)}
          />{" "}
          Use ChatGPT
        </Label>
        {usePlan && !account?.planEnabled && (
          <Alert role="status">
            <AlertDescription>Reconnect ChatGPT or enable access to continue.</AlertDescription>
          </Alert>
        )}
        {account?.usagePaused && (
          <Alert role="status">
            <AlertDescription>
              Plan requests are paused after a usage limit. Check your app allowance before
              retrying.
            </AlertDescription>
            <Button asChild>
              <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
                Manage usage
              </a>
            </Button>{" "}
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onResumePlan?.(account.clientId)}
            >
              Retry after checking usage
            </Button>
          </Alert>
        )}
        {account?.planEnabled && (
          <div>
            <Label htmlFor="chatgpt-tutor-model">
              {usePlan ? "Using ChatGPT plan" : "ChatGPT plan model"}
            </Label>
            <NativeSelect
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
            </NativeSelect>{" "}
            <Button type="button" variant="outline" disabled={busy} onClick={onReloadModels}>
              Refresh models
            </Button>{" "}
            <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">
              Manage usage
            </a>
          </div>
        )}
        <Collapsible>
          <CollapsibleTrigger className="w-full text-left font-medium">
            Account eligibility
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p>
              Availability depends on your ChatGPT account.{" "}
              <a href="https://help.openai.com/" target="_blank" rel="noreferrer">
                Learn more
              </a>
            </p>
          </CollapsibleContent>
        </Collapsible>
        {message && (
          <Alert role="status">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
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
  props: ComponentProps<typeof TutorPanel> & {
    readonly renderContent?: (api: typeof tutorApi) => ReactNode;
  },
) {
  const [state, setState] = useState<LocalChatGPTState | null>(null);
  const [models, setModels] = useState<typeof Models.Type>([]);
  const [model, setModel] = useState("");
  const [usePlan, setUsePlan] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<string | null>(null);
  const profile = state?.activeClientId ?? "";
  useEffect(() => {
    const target = props.searchTarget;
    if (!target || !("namespace" in target)) return;
    const frame = window.requestAnimationFrame(() => {
      if (target.namespace === "hosted" || target.namespace === "hosted:card-refinements")
        setUsePlan(false);
      else if (
        profile &&
        (target.namespace === `chatgpt:${profile}` ||
          target.namespace === `chatgpt:${profile}:card-refinements`)
      )
        setUsePlan(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.searchTarget, profile]);
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
        try: () => volatileStorage.getItem(`recall-chatgpt-welcome:${account.clientId}`),
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
      {profile && (
        <Collapsible className="space-y-4 py-4">
          <CollapsibleTrigger className="w-full text-left font-medium">
            AI usage limits
          </CollapsibleTrigger>
          <CollapsibleContent>
            <BudgetSettingsPanel key={profile} api={desktopBudgetApi} accountId={profile} />
          </CollapsibleContent>
        </Collapsible>
      )}
      {welcome && (
        <ChatGPTPlanWelcome
          onDismiss={() => {
            if (localWritesBlocked()) return;
            Effect.runSync(
              Effect.try({
                try: () => volatileStorage.setItem(`recall-chatgpt-welcome:${welcome}`, "1"),
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
          <Collapsible className="space-y-4 py-4">
            <CollapsibleTrigger className="w-full text-left font-medium">
              Research a topic
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ChatGPTResearchPanel
                key={`research:${profile}:${model}:${props.knowledgeArea.id}`}
                expectedClientId={profile}
                model={model}
                areaId={props.knowledgeArea.id}
                disabled={
                  busy ||
                  Boolean(
                    state.accounts.find((account) => account.clientId === profile)?.usagePaused,
                  )
                }
              />
            </CollapsibleContent>
          </Collapsible>
        )}
      {props.renderContent ? (
        props.renderContent(usePlan ? api : (props.api ?? tutorApi))
      ) : (
        <TutorPanel
          key={usePlan ? `chatgpt:${profile}:${model}` : "hosted"}
          {...props}
          {...(usePlan ? { api, privacyApi, sessionNamespace: `chatgpt:${profile}` } : {})}
        />
      )}
    </>
  );
}
