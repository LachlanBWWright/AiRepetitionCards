import { NativeButton } from "@recall/ui-native";

import { useState } from "react";
import { NativeAccountPanelTransfers } from "./NativeAccountPanelTransfers";
import { Text, TextInput, View } from "react-native";
import { Effect, Either } from "effect";
import { AccountActions, AccountConflictNotice } from "./NativeAccountPanelActions";

export function NativeAccountPanel({
  conflictAreas,
  onUseServerVersion,
  onImport,
  onExport,
  onImportDelimited,
  onExportDelimited,
  onBackupRestore,
  onBackupExport,
  onExportAccount,
  onDeleteAccount,
  account,
  cloudAvailable = true,
  onSignOut,
  onRequestSignIn,
  initialDeleteConfirmationOpen = false,
  ownershipIssue = null,
  onAdoptLegacyOwner,
  onResetForAccount,
}: {
  readonly onSync: () => Promise<string>;
  readonly conflictAreas: readonly string[] | null;
  readonly onUseServerVersion: () => Promise<string>;
  readonly onImport: () => Promise<string>;
  readonly onExport: () => Promise<string>;
  readonly onImportDelimited?: (format: "csv" | "tsv") => Promise<string>;
  readonly onExportDelimited?: (format: "csv" | "tsv") => Promise<string>;
  readonly onBackupRestore: () => Promise<string>;
  readonly onBackupExport: () => Promise<string>;
  readonly onExportAccount: () => Promise<string>;
  readonly onDeleteAccount: () => Promise<string>;
  readonly account: string | null;
  readonly cloudAvailable?: boolean;
  readonly onSignOut: () => Promise<string>;
  readonly onRequestSignIn: () => Promise<string>;
  readonly initialDeleteConfirmationOpen?: boolean;
  readonly ownershipIssue?: "account-mismatch" | "owner-adoption-required" | null;
  readonly onAdoptLegacyOwner?: () => Promise<string>;
  readonly onResetForAccount?: () => void;
}) {
  const [showAccountActions, setShowAccountActions] = useState(initialDeleteConfirmationOpen);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(initialDeleteConfirmationOpen);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");

  async function signInWithGoogle() {
    setBusy(true);
    setNotice(null);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: onRequestSignIn,
          catch: () => ({ _tag: "NativeSignInRequestError" }) as const,
        }),
      ),
    );
    setBusy(false);
    setNotice(
      Either.isRight(result) ? result.right : "Google sign-in could not start. Please try again.",
    );
  }

  async function signOut() {
    setBusy(true);
    setNotice(null);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: onSignOut,
          catch: () => ({ _tag: "SignOutRequestError" }) as const,
        }),
      ),
    );
    setBusy(false);
    setNotice(
      Either.isRight(result)
        ? result.right
        : "Could not sign out. Your current account session is unchanged.",
    );
  }

  async function applyServerVersion() {
    setResolvingConflict(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: onUseServerVersion,
          catch: () => ({ _tag: "ConflictResolutionError" }) as const,
        }),
      ),
    );
    setResolvingConflict(false);
    setNotice(Either.isRight(result) ? result.right : "The server content could not be loaded.");
  }

  async function runFileAction(action: () => Promise<string>) {
    setFileBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: action,
          catch: () => ({ _tag: "NativeFileActionError" }) as const,
        }),
      ),
    );
    setFileBusy(false);
    setNotice(Either.isRight(result) ? result.right : "The file action could not be completed.");
  }

  async function deleteAccount() {
    if (deleteConfirmation !== "DELETE") return;
    setFileBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: onDeleteAccount,
          catch: () => ({ _tag: "NativeAccountDeletionError" }) as const,
        }),
      ),
    );
    setFileBusy(false);
    setShowDelete(false);
    setDeleteConfirmation("");
    setNotice(
      Either.isRight(result)
        ? result.right
        : "Account deletion failed. Your account and local data remain available.",
    );
  }

  const exportAccount = () => {
    void runFileAction(onExportAccount);
  };
  const handleSignOut = () => {
    void signOut();
  };

  return (
    <View className={"gap-4 py-6 border-t-recall-line border-t"} testID="native-account-panel">
      <View className={"gap-2"}>
        <Text className={"text-recall-ink text-[15px] font-bold"}>
          {cloudAvailable ? "Recall account (optional)" : "Files and backups"}
        </Text>
        {account ? <Text className={"text-recall-darkGreen text-[12px]"}>{account}</Text> : null}
      </View>
      {!cloudAvailable && (
        <Text className={"text-recall-muted text-[12px]"}>Sync is unavailable on this device.</Text>
      )}
      <NativeAccountPanelTransfers
        fileBusy={fileBusy}
        syncBusy={false}
        ownershipIssue={cloudAvailable ? ownershipIssue : null}
        onAdoptLegacyOwner={onAdoptLegacyOwner}
        onResetForAccount={onResetForAccount}
        onImport={onImport}
        onExport={onExport}
        onImportDelimited={onImportDelimited}
        onExportDelimited={onExportDelimited}
        onBackupRestore={onBackupRestore}
        onBackupExport={onBackupExport}
        runFileAction={(action) => void runFileAction(action)}
      />
      {cloudAvailable && account ? (
        <>
          <AccountActions
            expanded={showAccountActions}
            fileBusy={fileBusy}
            busy={busy}
            syncBusy={false}
            resolvingConflict={resolvingConflict}
            onToggle={() => {
              setShowAccountActions((value) => !value);
            }}
            onExport={exportAccount}
            onSignOut={handleSignOut}
            onDelete={() => {
              setShowDelete(true);
            }}
          />
          {conflictAreas ? (
            <AccountConflictNotice
              areas={conflictAreas}
              resolving={resolvingConflict}
              disabled={resolvingConflict}
              onUseServer={() => {
                void applyServerVersion();
              }}
            />
          ) : null}
        </>
      ) : cloudAvailable ? (
        <NativeButton
          label={busy ? "Opening Google…" : "Continue with Google"}
          accessibilityState={{ busy }}
          disabled={busy}
          onPress={() => void signInWithGoogle()}
        />
      ) : null}
      {cloudAvailable && showDelete ? (
        <View className={"gap-4 py-6 border-t border-[#fca5a5]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>
            Delete your account and data?
          </Text>
          <Text className={"text-recall-muted text-[12px]"}>
            This removes synced account data and this device’s workspace and attachments. Signing
            out alone keeps offline data. Export account data first if you need a copy.
          </Text>
          <View className="gap-2">
            <Text className={"text-recall-muted text-[12px]"}>Type DELETE to confirm.</Text>
            <TextInput
              accessibilityLabel="Type DELETE to confirm account deletion"
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!fileBusy}
              onChangeText={setDeleteConfirmation}
              value={deleteConfirmation}
              className="w-full min-h-12 rounded-xl bg-recall-paper px-3 text-base text-recall-ink"
            />
          </View>
          <View className="gap-2">
            <NativeButton
              label="Cancel"
              variant="secondary"
              disabled={fileBusy}
              onPress={() => {
                setShowDelete(false);
                setDeleteConfirmation("");
              }}
            />
            <NativeButton
              label={fileBusy ? "Deleting…" : "Delete account and data"}
              variant="destructive"
              disabled={fileBusy || deleteConfirmation !== "DELETE"}
              onPress={() => void deleteAccount()}
            />
          </View>
        </View>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" className={"text-recall-muted text-[12px]"}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}
