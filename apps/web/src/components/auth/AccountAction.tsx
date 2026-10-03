"use client";

import { useEffect, useState } from "react";
import { Effect, Either, Fiber, Schema } from "effect";
import type { Workspace } from "@/features/workspace/types";
import { Dialog } from "@/components/ui/Dialog";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { readSupabaseConfig } from "@/lib/supabase/config";
import { DesktopAccountAction } from "@/components/auth/DesktopAccountAction";
import { isDesktopRuntime } from "@/lib/desktop-api";
import { apiFetch } from "@/lib/desktop-api";
import { clearWorkspace } from "@recall/application";
import { browserWorkspaceStore } from "@/features/workspace/browser-workspace-store";

const AccountExportSchema = Schema.Struct({
  format: Schema.Literal("recall-account-export"),
  version: Schema.Literal(1),
  exportedAt: Schema.String,
  account: Schema.Unknown,
  data: Schema.Unknown,
});

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
  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(demoDeleteConfirm);
  const [confirmation, setConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const isConfigured = readSupabaseConfig()._tag === "Right";

  useEffect(() => {
    if (demo || isDesktopRuntime()) return;
    const client = createSupabaseBrowserClient();
    if (!client) return;

    let mounted = true;
    const lookup = Effect.tryPromise({
      try: () => client.auth.getUser(),
      catch: () => ({ _tag: "AccountLookupError" }) as const,
    }).pipe(
      Effect.match({
        onFailure: () => null,
        onSuccess: ({ data }) => data.user?.email ?? null,
      }),
      Effect.tap((accountEmail) =>
        Effect.sync(() => {
          if (mounted) setEmail(accountEmail);
        }),
      ),
    );
    const fiber = Effect.runFork(lookup);
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      setEmail(session?.user.email ?? null);
    });

    return () => {
      mounted = false;
      data.subscription.unsubscribe();
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [demo]);

  async function exportAccount() {
    if (demo) {
      setMessage("Mock account export is ready.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const exportProgram = Effect.tryPromise({
      try: async () => {
        const response = await apiFetch("/api/v1/account/export");
        if (!response.ok) return { _tag: "ExportFailure" } as const;
        const cloudData = Schema.decodeUnknownEither(AccountExportSchema)(await response.json());
        if (Either.isLeft(cloudData)) return { _tag: "ExportFailure" } as const;
        const exportData = {
          ...cloudData.right,
          browserWorkspace: workspace ?? null,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `recall-account-export-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(url);
        return { _tag: "Exported" } as const;
      },
      catch: () => ({ _tag: "ExportFailure" }) as const,
    }).pipe(
      Effect.match({
        onFailure: () => setMessage("Your account export could not be downloaded. Try again."),
        onSuccess: (result) =>
          setMessage(
            result._tag === "Exported"
              ? "Your account data has been downloaded."
              : "Your account export could not be downloaded. Try again.",
          ),
      }),
      Effect.ensuring(Effect.sync(() => setBusy(false))),
    );
    Effect.runFork(exportProgram);
  }

  async function deleteAccount() {
    if (demo) {
      setMessage("Mock account deletion confirmed.");
      setShowDeleteConfirm(false);
      return;
    }
    if (confirmation !== "DELETE") return;
    setDeleting(true);
    setMessage(null);
    const deletionProgram = Effect.tryPromise({
      try: async () => {
        const response = await apiFetch("/api/v1/account/delete", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmation }),
        });
        if (!response.ok) return { _tag: "DeleteFailure" } as const;
        const cleared = await Effect.runPromise(
          Effect.either(clearWorkspace(browserWorkspaceStore)),
        );
        for (const key of Object.keys(window.localStorage)) {
          if (key.startsWith("recall-tutor-session:")) window.localStorage.removeItem(key);
        }
        return { _tag: "Deleted", workspaceCleared: Either.isRight(cleared) } as const;
      },
      catch: () => ({ _tag: "DeleteFailure" }) as const,
    }).pipe(
      Effect.match({
        onFailure: () => setMessage("Account deletion failed. Try again or contact support."),
        onSuccess: (result) => {
          if (result._tag === "Deleted" && result.workspaceCleared) {
            if (isDesktopRuntime()) window.location.reload();
            else window.location.replace("/sign-in?account=deleted");
          } else if (result._tag === "Deleted") {
            setMessage("Account deleted, but this device could not clear its local workspace.");
          } else {
            setMessage("Account deletion failed. Try again or contact support.");
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
          className="modal"
          onSubmit={(event) => {
            event.preventDefault();
            void deleteAccount();
          }}
        >
          <p className="eyebrow">ACCOUNT SETTINGS</p>
          <h2 id="delete-account-title">Delete your account?</h2>
          <p className="modal-copy">
            This permanently deletes your account, synced learning data, and this device&apos;s
            local workspace. Download an account export first if you want a copy.
          </p>
          <label htmlFor="delete-account-confirmation">Type DELETE to confirm</label>
          <input
            id="delete-account-confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            disabled={deleting}
            required
          />
          {message && (
            <p className="tutor-error" role="alert">
              {message}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="cancel-button"
              disabled={deleting}
              onClick={() => {
                setShowDeleteConfirm(false);
                setConfirmation("");
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="danger-button"
              disabled={deleting || confirmation !== "DELETE"}
            >
              {deleting ? "Deleting…" : "Delete account and data"}
            </button>
          </div>
        </form>
      </Dialog>
    );
  }

  if (demo && demoEmail) {
    return (
      <>
        <div className="account-action account-action-demo">
          <span className="account-email">{demoEmail}</span>
          <button className="text-button" type="button" onClick={() => void exportAccount()}>
            Export account data
          </button>
          <button className="text-button" type="button" onClick={() => setShowDeleteConfirm(true)}>
            Delete account
          </button>
          <button className="text-button" type="button" disabled>
            Sign out
          </button>
          {message && <span className="saved-state">{message}</span>}
        </div>
        {deleteConfirmationDialog()}
      </>
    );
  }
  if (!demo && typeof window !== "undefined" && window.recallDesktop)
    return <DesktopAccountAction />;
  if (demo || !isConfigured) {
    return (
      <a className="text-button" href="/sign-in">
        Sign in
      </a>
    );
  }
  if (email === undefined) {
    return <span className="saved-state">Checking account…</span>;
  }
  if (!email) {
    return (
      <a className="text-button" href="/sign-in">
        Sign in
      </a>
    );
  }

  return (
    <>
      <form action="/auth/sign-out" method="post" className="account-action">
        <span className="account-email">{email}</span>
        <button
          className="text-button"
          type="button"
          disabled={busy}
          onClick={() => void exportAccount()}
        >
          {busy ? "Preparing export…" : "Export account data"}
        </button>
        <button className="text-button" type="button" onClick={() => setShowDeleteConfirm(true)}>
          Delete account
        </button>
        <button className="text-button" type="submit">
          Sign out
        </button>
        {message && <span className="saved-state">{message}</span>}
      </form>
      {deleteConfirmationDialog()}
    </>
  );
}
