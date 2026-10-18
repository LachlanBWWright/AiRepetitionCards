import { useCallback, useEffect, useState } from "react";
import { Effect, Either } from "effect";
import * as Linking from "expo-linking";
import {
  nativeChatGPTAuth,
  nativeChatGPTAvailable,
  nativeChatGPTFailureMessage,
} from "../storage/auth/native-chatgpt-auth";
import { selectTutorModel, tutorApiFailureMessage } from "@recall/application";
import { nativeChatGPTPlan } from "../storage/ai/native-chatgpt-tutor";
import type { NativeChatGPTModel } from "../storage/ai/chatgpt-plan-client";
import type { ChatGPTAuthFailure, ChatGPTAuthStatus } from "../storage/auth/chatgpt-auth";

export function useNativeChatGPTAuth() {
  const [available, setAvailable] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<ChatGPTAuthStatus>({ activeClientId: null, accounts: [] });
  const [busy, setBusy] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tutorMode, setTutorMode] = useState<"chatgpt" | "hosted">("chatgpt");
  const [selection, setSelection] = useState<{
    readonly clientId: string | null;
    readonly slug: string;
  } | null>(null);
  const [catalog, setCatalog] = useState<{
    readonly key: string;
    readonly models: readonly NativeChatGPTModel[];
    readonly message: string | null;
  } | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(0);
  const activeClientId = status.activeClientId;
  const connectionEpoch = nativeChatGPTAuth.epoch();
  const catalogKey = `${activeClientId ?? "none"}:${String(connectionEpoch)}:${String(catalogVersion)}`;
  const planEnabled = status.accounts.some(
    (account) => account.clientId === activeClientId && account.signedIn && account.planEnabled,
  );
  const models = planEnabled && catalog?.key === catalogKey ? catalog.models : [];
  const model = selectTutorModel(
    models,
    selection?.clientId === activeClientId ? selection.slug : "",
  );
  const modelsBusy = activeClientId !== null && planEnabled && catalog?.key !== catalogKey;
  const modelsMessage = planEnabled && catalog?.key === catalogKey ? catalog.message : null;
  useEffect(() => {
    if (!activeClientId || !planEnabled) return;
    let current = true;
    void Effect.runPromise(Effect.either(nativeChatGPTPlan.models(activeClientId))).then(
      (result) => {
        if (!current) return;
        setCatalog({
          key: catalogKey,
          models: Either.isRight(result) ? result.right : [],
          message: Either.isLeft(result)
            ? tutorApiFailureMessage(result.left)
            : result.right.length === 0
              ? "No supported models are available for this ChatGPT account."
              : null,
        });
      },
    );
    return () => {
      current = false;
    };
  }, [activeClientId, planEnabled, catalogKey]);

  useEffect(() => {
    let mounted = true;
    const refresh = () => {
      void Effect.runPromise(Effect.either(nativeChatGPTAuth.status)).then((result) => {
        if (!mounted) return;
        if (Either.isRight(result)) setStatus(result.right);
        else setMessage(nativeChatGPTFailureMessage(result.left));
      });
    };
    const unsubscribe = nativeChatGPTAuth.subscribe(refresh);
    void Effect.runPromise(nativeChatGPTAvailable()).then((supported) => {
      if (!mounted) return;
      setAvailable(supported);
      setReady(true);
      if (supported) refresh();
    });
    return () => {
      mounted = false;
      unsubscribe();
      Effect.runFork(nativeChatGPTAuth.cancel().pipe(Effect.ignore));
    };
  }, []);
  const run = useCallback(
    (operation: Effect.Effect<string, ChatGPTAuthFailure>, signIn = false) => {
      setBusy(true);
      setSigningIn(signIn);
      setMessage(null);
      Effect.runFork(
        operation.pipe(
          Effect.match({
            onFailure: (error) => {
              setMessage(nativeChatGPTFailureMessage(error));
            },
            onSuccess: setMessage,
          }),
          Effect.ensuring(
            Effect.sync(() => {
              setBusy(false);
              setSigningIn(false);
            }),
          ),
        ),
      );
    },
    [],
  );
  return {
    connectionEpoch,
    tutorMode,
    setTutorMode,
    models,
    model,
    setModel: (slug: string) => {
      setSelection({ clientId: activeClientId, slug });
    },
    modelsBusy,
    modelsMessage,
    refreshModels: () => {
      setCatalogVersion((version) => version + 1);
    },
    ready,
    available,
    status,
    busy,
    signingIn,
    message,
    signIn: (clientId: string | null, enablePlan = false) => {
      run(
        nativeChatGPTAuth
          .signIn(clientId, enablePlan)
          .pipe(
            Effect.as(
              "ChatGPT connected separately from Recall. Plan access requires the account’s approved grant.",
            ),
          ),
        true,
      );
    },
    cancel: () => {
      Effect.runFork(nativeChatGPTAuth.cancel().pipe(Effect.ignore));
    },
    signOut: (clientId: string) => {
      run(
        nativeChatGPTAuth
          .signOut(clientId)
          .pipe(
            Effect.map((result) =>
              result.remoteRevocationConfirmed
                ? "Signed out of ChatGPT and revoked this session. Your Recall session is unchanged."
                : "Signed out of ChatGPT on this device. Remote revocation could not be confirmed; disconnect the app in ChatGPT Settings → Usage.",
            ),
          ),
      );
    },
    manageUsage: () => {
      run(
        Effect.tryPromise({
          try: async () => {
            await Linking.openURL("https://chatgpt.com/settings/usage");
            return "Manage app access in ChatGPT usage settings.";
          },
          catch: (): ChatGPTAuthFailure => ({
            _tag: "ChatGPTAuthFailure",
            code: "browser-unavailable",
          }),
        }),
      );
    },
  };
}
