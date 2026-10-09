"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Effect, Fiber, Either, Schema } from "effect";
import type { Workspace } from "@/features/workspace/types";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Alert, Input, toast } from "@recall/ui-web";
import {
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { readBrowserSession } from "@/lib/auth/browser-session";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { DesktopAccountAction } from "@/components/auth/DesktopAccountAction";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { browserAccountApi } from "@/lib/account-api";
import { exportAccountData, deleteAccountData } from "@recall/application";
import { eraseLocalData } from "@/features/workspace/erase-local-data";
import { sharedPublicationReturnPath } from "@/lib/auth/return-path";
import { BudgetSettingsPanel } from "./BudgetSettingsPanel";
import { browserLocalBudget } from "@/lib/local-ai-budget";
import { ChatGPTAccountConnection } from "./ChatGPTAccountConnection";

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
      const publishEmail = (input: unknown) => {
        const decoded = Schema.decodeUnknownEither(
          Schema.Struct({ email: Schema.NullOr(Schema.String) }),
        )(input);
        if (active && Either.isRight(decoded)) setEmail(decoded.right.email);
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
    const lookup = readBrowserSession().pipe(
      Effect.match({
        onFailure: () => null,
        onSuccess: (session) =>
          session.authenticated ? (session.displayLabel ?? "Recall account") : null,
      }),
      Effect.tap((accountLabel) =>
        Effect.sync(() => {
          if (mounted) setEmail(accountLabel);
        }),
      ),
    );
    const fiber = Effect.runFork(lookup);
    return () => {
      mounted = false;
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [demo]);

  async function exportAccount() {
    if (demo) {
      toast.success("Mock account export is ready.");
      return;
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
        onFailure: () => setMessage("Your account export could not be downloaded. Try again."),
        onSuccess: () => toast.success("Your account data has been downloaded."),
      }),
      Effect.ensuring(Effect.sync(() => setBusy(false))),
    );
    Effect.runFork(exportProgram);
  }

  async function deleteAccount() {
    if (demo) {
      toast.success("Mock account deletion confirmed.");
      setShowDeleteConfirm(false);
      return;
    }
    if (!accountDeleted && confirmation !== "DELETE") return;
    setDeleting(true);
    setMessage(null);
    const deletionProgram = (
      accountDeleted ? Effect.void : deleteAccountData(browserAccountApi, confirmation)
    ).pipe(
      Effect.tap(() => Effect.sync(() => setAccountDeleted(true))),
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
        onFailure: () => setMessage("Account deletion failed. Try again or contact support."),
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
      Effect.ensuring(Effect.sync(() => setDeleting(false))),
    );
    Effect.runFork(deletionProgram);
  }

  function deleteConfirmationDialog() {
    if (!showDeleteConfirm) return null;
    return (
      <Dialog
        labelledBy="delete-account-title"
        onClose={() => {
          if (deleting) return;
          setShowDeleteConfirm(false);
          setConfirmation("");
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void deleteAccount();
          }}
        >
          <DialogHeader>
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              ACCOUNT SETTINGS
            </p>
            <DialogTitle id="delete-account-title">Delete your account?</DialogTitle>
          </DialogHeader>
          <DialogDescription>
            This permanently deletes your account and synced learning data. Download an account
            export first if you want a copy.
          </DialogDescription>
          <label htmlFor="delete-account-confirmation">Type DELETE to confirm</label>
          <Input
            id="delete-account-confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={deleting}
            required
          />
          {message && <Alert variant="destructive">{message}</Alert>}
          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="secondary"
              type="button"
              disabled={deleting}
              onClick={() => {
                setShowDeleteConfirm(false);
                setConfirmation("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              type="submit"
              disabled={deleting || (!accountDeleted && confirmation !== "DELETE")}
            >
              {deleting
                ? "Deleting…"
                : accountDeleted
                  ? "Retry clearing this tab"
                  : "Delete account and data"}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
    );
  }

  if (demo && demoEmail) {
    return (
      <>
        <div data-slot="account-action" className="flex flex-wrap items-center gap-2">
          <span className="mr-auto text-sm text-muted-foreground">{demoEmail}</span>
          <Button variant="secondary" type="button" onClick={() => void exportAccount()}>
            Export account data
          </Button>
          <Button variant="secondary" type="button" onClick={() => setShowDeleteConfirm(true)}>
            Delete account
          </Button>
          <Button variant="secondary" type="button" disabled>
            Sign out
          </Button>
          {message && <Alert role="status">{message}</Alert>}
        </div>
        {deleteConfirmationDialog()}
      </>
    );
  }
  const desktop = !demo && isDesktopRuntime();
  if (desktop && !email && !accountDeleted) return <DesktopAccountAction />;
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
      <form
        action="/auth/sign-out"
        method="post"
        data-slot="account-action"
        className="flex flex-wrap items-center gap-2"
      >
        <span className="mr-auto text-sm text-muted-foreground">
          {email && /^chatgpt\+[a-f0-9]{48}@identity\.recall\.invalid$/.test(email)
            ? "ChatGPT account"
            : email}
        </span>
        {desktop ? <DesktopAccountAction /> : <ChatGPTAccountConnection compact />}
        <Button
          variant="secondary"
          type="button"
          disabled={busy}
          onClick={() => void exportAccount()}
        >
          {busy ? "Preparing export…" : "Export account data"}
        </Button>
        <Button variant="secondary" type="button" onClick={() => setShowDeleteConfirm(true)}>
          Delete account
        </Button>
        {!desktop && (
          <Button variant="secondary" type="submit">
            Sign out
          </Button>
        )}
        {message && <Alert variant="destructive">{message}</Alert>}
      </form>
      {ownerId && (
        <Button variant="secondary" type="button" onClick={() => setShowBudget(!showBudget)}>
          AI budget settings
        </Button>
      )}
      {ownerId && showBudget && (
        <BudgetSettingsPanel
          key={ownerId}
          api={browserLocalBudget}
          accountId={`hosted:${ownerId}`}
        />
      )}
      {deleteConfirmationDialog()}
    </>
  );
}
