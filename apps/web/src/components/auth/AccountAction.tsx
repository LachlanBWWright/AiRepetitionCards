"use client";

import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { Download, LogOut, Trash2 } from "lucide-react";
import { Effect, Fiber, Either, Schema } from "effect";
import type { Workspace } from "@/features/workspace/types";
import { Button } from "@/components/ui/Button";
import { Alert, toast } from "@recall/ui-web";
import { readBrowserSession } from "@/lib/auth/browser-session";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { TutorPrivacyControls } from "@/components/tutor/connection/TutorPrivacyControls";
import { DesktopAISettings } from "@/components/tutor/connection/LocalChatGPTTutor";
import { DesktopAccountAction } from "@/components/auth/DesktopAccountAction";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { browserAccountApi } from "@/lib/account-api";
import { exportAccountData, deleteAccountData } from "@recall/application";
import { eraseLocalData } from "@/features/workspace/erase-local-data";
import { sharedPublicationReturnPath } from "@/lib/auth/return-path";
import { browserLocalBudget } from "@/lib/local-ai-budget";
import { ChatGPTAccountConnection } from "./ChatGPTAccountConnection";
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
    window.dispatchEvent(new CustomEvent("recall-tutor-history-cleared", { detail: "hosted" }));
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
        <div data-slot="account-action" className="grid gap-3">
          <p className="break-all text-sm text-muted-foreground">{demoEmail}</p>
          <Button variant="secondary" type="button" onClick={() => void exportAccount()}>
            <Download aria-hidden="true" className="size-4" />
            Export account data
          </Button>
          <Button
            variant="secondary"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            type="button"
            onClick={() => {
              setShowDeleteConfirm(true);
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" />
            Delete account
          </Button>
          <Button variant="secondary" type="button" disabled>
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
          <a
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={signInHref}
          >
            Sign in
          </a>
        )}
        {demo && (
          <a
            className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            href={signInHref}
          >
            Sign in
          </a>
        )}
      </div>
    );
  }
  if (email === undefined) {
    return <Alert role="status">Checking account…</Alert>;
  }
  if (!email && !accountDeleted) {
    return (
      <a
        className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        href={signInHref}
      >
        Sign in
      </a>
    );
  }

  return (
    <>
      <div data-slot="account-action" className="grid gap-4">
        <div className="min-w-0 space-y-1">
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
            <ChatGPTAccountConnection compact />
            <TutorPrivacyControls
              demo={demo}
              disabled={busy}
              onBusyChange={setBusy}
              onCleared={handleCleared}
            />
          </>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            variant="secondary"
            type="button"
            disabled={busy}
            onClick={() => void exportAccount()}
          >
            <Download aria-hidden="true" className="size-4" />
            {busy ? "Preparing export…" : "Export account data"}
          </Button>
          <Button
            variant="secondary"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            type="button"
            onClick={() => {
              setShowDeleteConfirm(true);
            }}
          >
            <Trash2 aria-hidden="true" className="size-4" />
            Delete account
          </Button>
        </div>
        {!desktop && (
          <form action="/auth/sign-out" method="post">
            <Button variant="secondary" type="submit" className="w-full">
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
