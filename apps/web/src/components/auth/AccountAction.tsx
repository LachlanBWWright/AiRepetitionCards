"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { LogOut } from "lucide-react";
import { Effect, Fiber, Either, Schema } from "effect";
import type { Workspace } from "@/features/workspace/types";
import { Button } from "@/components/ui/Button";
import { Alert, toast } from "@recall/ui-web";
import { readBrowserSession } from "@/lib/auth/browser-session";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { TutorPrivacyControls } from "@/components/tutor/connection/TutorPrivacyControls";
import { AiFundingSettings } from "@/components/tutor/funding/AiFundingSettings";
import { DesktopAISettings } from "@/components/tutor/connection/LocalChatGPTTutor";
import { DesktopAccountAction } from "@/components/auth/DesktopAccountAction";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { browserAccountApi } from "@/lib/account-api";
import { exportAccountData, deleteAccountData } from "@recall/application";
import { eraseLocalData } from "@/features/workspace/erase-local-data";
import { sharedPublicationReturnPath } from "@/lib/auth/return-path";
import { browserLocalBudget } from "@/lib/local-ai-budget";
import { ChatGPTAccountConnection } from "./ChatGPTAccountConnection";
import { AccountDataActions } from "./AccountDataActions";
import { AccountActionDeleteConfirmation } from "./AccountActionDeleteConfirmation";
import { AccountActionBudgetSettings } from "./AccountActionBudgetSettings";

export function AccountAction({
  demo = false,
  demoEmail,
  demoDeleteConfirm = false,
  workspace,
}: {
  demo?: boolean;
  demoEmail?: string;
  demoDeleteConfirm?: boolean;
  workspace?: Workspace;
}) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [showBudget, setShowBudget] = useState(false);
  const budgetPanelId = useId();
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const signInHref = useSyncExternalStore(
    () => () => undefined,
    () => {
      const returnPath = sharedPublicationReturnPath(
        `${window.location.pathname}${window.location.search}`,
      );
      return returnPath === "/" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(returnPath)}`;
    },
    () => "/sign-in",
  );
  const [busy, setBusy] = useState(false);
  const handleCleared = () => {
    window.dispatchEvent(
      new CustomEvent("recall-tutor-history-cleared", {
        detail: `managed:${ownerId ?? "disconnected"}`,
      }),
    );
  };
  const [message, setMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(demoDeleteConfirm);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [accountDeleted, setAccountDeleted] = useState(false);
  const isConfigured = readSupabaseConfig()._tag === "Right";

  useEffect(() => {
    if (demo) return;
    void Effect.runPromise(Effect.either(readBrowserSession())).then((result) => {
      if (Either.isRight(result)) setOwnerId(result.right.ownerId);
    });
    const desktop = window.recallDesktop;
    if (desktop) {
      let active = true;
      const isActive = () => active;
      const publishEmail = (input: unknown) => {
        const decoded = Schema.decodeUnknownEither(
          Schema.Struct({ email: Schema.NullOr(Schema.String) }),
        )(input);
        if (isActive() && Either.isRight(decoded)) setEmail(decoded.right.email);
      };
      const unsubscribe = desktop.auth.onStateChanged(publishEmail);
      void Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => desktop.auth.getStatus(),
            catch: () => ({ _tag: "DesktopAccountLookupFailure" }) as const,
          }),
        ),
      ).then((result) => {
        if (
          Either.isRight(result) &&
          typeof result.right === "object" &&
          result.right !== null &&
          "value" in result.right
        )
          publishEmail(result.right.value);
      });
      return () => {
        active = false;
        unsubscribe();
      };
    }
    let mounted = true;
    const isMounted = () => mounted;
    const lookup = readBrowserSession().pipe(
      Effect.match({
        onFailure: () => null,
        onSuccess: (session) => (session.authenticated ? session.displayLabel : null),
      }),
      Effect.tap((accountLabel) =>
        Effect.sync(() => {
          if (isMounted()) setEmail(accountLabel);
        }),
      ),
    );
    const fiber = Effect.runFork(lookup);
    return () => {
      mounted = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [demo]);

  function exportAccount() {
    if (demo) {
      toast.success("Mock account export is ready.");
      return Promise.resolve(undefined);
    }
    setBusy(true);
    setMessage(null);
    const exportProgram = exportAccountData(browserAccountApi).pipe(
      Effect.flatMap((cloudData) =>
        Effect.try({
          try: () => {
            const exportData = { ...cloudData, browserWorkspace: workspace ?? null };
            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            try {
              const link = document.createElement("a");
              link.href = url;
              link.download = `recall-account-export-${cloudData.exportedAt.slice(0, 10)}.json`;
              link.click();
            } finally {
              URL.revokeObjectURL(url);
            }
          },
          catch: () => ({ _tag: "AccountDownloadFailure" }) as const,
        }),
      ),
      Effect.match({
        onFailure: () => {
          setMessage("Your account export could not be downloaded. Try again.");
        },
        onSuccess: () => toast.success("Your account data has been downloaded."),
      }),
      Effect.ensuring(
        Effect.sync(() => {
          setBusy(false);
        }),
      ),
    );
    Effect.runFork(exportProgram);

    return Promise.resolve(undefined);
  }

  function deleteAccount() {
    if (demo) {
      toast.success("Mock account deletion confirmed.");
      setShowDeleteConfirm(false);
      return Promise.resolve(undefined);
    }
    if (!accountDeleted && confirmation !== "DELETE") return Promise.resolve(undefined);
    setDeleting(true);
    setMessage(null);
    const deletionProgram = (
      accountDeleted ? Effect.void : deleteAccountData(browserAccountApi, confirmation)
    ).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          setAccountDeleted(true);
        }),
      ),
      Effect.flatMap(() =>
        Effect.gen(function* () {
          const cleared = yield* eraseLocalData();
          const desktopAuth = window.recallDesktop?.auth;
          if (!desktopAuth) return cleared;
          const session = yield* Effect.either(
            Effect.tryPromise({
              try: () => desktopAuth.signOut(),
              catch: () => ({ _tag: "DesktopSessionCleanupFailure" }) as const,
            }),
          );
          if (Either.isLeft(session)) return false;
          const decoded = Schema.decodeUnknownEither(
            Schema.Struct({ _tag: Schema.Literal("Success"), value: Schema.Boolean }),
          )(session.right);
          return cleared && Either.isRight(decoded) && decoded.right.value;
        }),
      ),
      Effect.match({
        onFailure: () => {
          setMessage("Account deletion failed. Try again or contact support.");
        },
        onSuccess: (localDataCleared) => {
          if (localDataCleared) {
            if (isDesktopRuntime()) window.location.reload();
            else window.location.replace("/sign-in?account=deleted");
          } else {
            setMessage(
              "Account deleted. This tab is read-only until its working copy is cleared. Retry clearing this tab.",
            );
          }
        },
      }),
      Effect.ensuring(
        Effect.sync(() => {
          setDeleting(false);
        }),
      ),
    );
    Effect.runFork(deletionProgram);

    return Promise.resolve(undefined);
  }

  const resetDeleteConfirmation = () => {
    setShowDeleteConfirm(false);
    setConfirmation("");
  };
  const closeDeleteConfirmation = () => {
    if (deleting) return;
    resetDeleteConfirmation();
  };
  const confirmDelete = () => {
    void deleteAccount();
  };
  const deleteConfirmationProps = {
    accountDeleted,
    confirmation,
    deleting,
    message,
    onCancel: resetDeleteConfirmation,
    onChange: setConfirmation,
    onClose: closeDeleteConfirmation,
    onConfirm: confirmDelete,
    open: showDeleteConfirm,
  };

  if (demo && demoEmail) {
    return (
      <>
        <div data-slot="account-action" className="grid gap-4">
          <p className="break-all text-sm text-muted-foreground">{demoEmail}</p>
          <AccountDataActions
            busy={busy}
            onExport={() => void exportAccount()}
            onDelete={() => {
              setShowDeleteConfirm(true);
            }}
          />
          <Button className="w-full" variant="default" type="button" disabled>
            Sign out
          </Button>
          {message && <Alert role="status">{message}</Alert>}
        </div>
        <AccountActionDeleteConfirmation {...deleteConfirmationProps} />
      </>
    );
  }
  const desktop = !demo && isDesktopRuntime();
  if (desktop && !email && !accountDeleted)
    return (
      <div className="grid gap-4">
        <DesktopAISettings />
        <DesktopAccountAction />
      </div>
    );
  if (demo || (!isConfigured && !desktop)) {
    return (
      <div data-slot="account-action" className="flex flex-wrap items-center gap-2">
        {!demo && (
          <p className="text-sm text-muted-foreground">Web study requires a signed-in account.</p>
        )}
        {!demo && isConfigured && (
          <Button asChild variant="default" size="default">
            <a href={signInHref}>Sign in</a>
          </Button>
        )}
        {demo && (
          <Button asChild variant="default" size="default">
            <a href={signInHref}>Sign in</a>
          </Button>
        )}
      </div>
    );
  }
  if (email === undefined) {
    return <Alert role="status">Checking account…</Alert>;
  }
  if (!email && !accountDeleted) {
    return (
      <Button asChild variant="default" size="default">
        <a href={signInHref}>Sign in</a>
      </Button>
    );
  }

  return (
    <>
      <div data-slot="account-action" className="grid gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs text-muted-foreground">Signed in as</p>
          <p className="break-all text-sm font-medium">
            {email && /^chatgpt\+[a-f0-9]{48}@identity\.recall\.invalid$/.test(email)
              ? "ChatGPT account"
              : email}
          </p>
        </div>
        {desktop ? (
          <>
            <DesktopAISettings />
            <DesktopAccountAction />
          </>
        ) : (
          <>
            <AiFundingSettings />
            <ChatGPTAccountConnection compact />
            <TutorPrivacyControls
              demo={demo}
              disabled={busy}
              onBusyChange={setBusy}
              onCleared={handleCleared}
            />
          </>
        )}
        <AccountDataActions
          busy={busy}
          onExport={() => void exportAccount()}
          onDelete={() => {
            setShowDeleteConfirm(true);
          }}
        />
        {!desktop && (
          <form action="/auth/sign-out" method="post">
            <Button variant="default" type="submit" className="w-full">
              <LogOut aria-hidden="true" className="size-4" />
              Sign out
            </Button>
          </form>
        )}
        {message && <Alert variant="destructive">{message}</Alert>}
      </div>
      {ownerId && (
        <AccountActionBudgetSettings
          accountId={`hosted:${ownerId}`}
          api={browserLocalBudget}
          open={showBudget}
          panelId={budgetPanelId}
          onToggle={() => {
            setShowBudget(!showBudget);
          }}
        />
      )}
      <AccountActionDeleteConfirmation {...deleteConfirmationProps} />
    </>
  );
}
