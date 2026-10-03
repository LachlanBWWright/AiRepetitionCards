import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Effect, Either } from "effect";
import { designTokens } from "@recall/design-tokens";

const palette = designTokens.color;

export function NativeAccountPanel({
  onSync,
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
  readonly onRequestSignIn: (email: string) => Promise<string>;
  readonly initialDeleteConfirmationOpen?: boolean;
  readonly ownershipIssue?: "account-mismatch" | "owner-adoption-required" | null;
  readonly onAdoptLegacyOwner?: () => Promise<string>;
  readonly onResetForAccount?: () => void;
}) {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [fileBusy, setFileBusy] = useState(false);
  const [showDelete, setShowDelete] = useState(initialDeleteConfirmationOpen);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [confirmOwnership, setConfirmOwnership] = useState(false);

  async function requestLink() {
    setBusy(true);
    setNotice(null);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: () => onRequestSignIn(email.trim()),
          catch: () => ({ _tag: "NativeSignInRequestError" }) as const,
        }),
      ),
    );
    setBusy(false);
    setNotice(
      Either.isRight(result)
        ? result.right
        : "Could not send a sign-in link. Check your email and connection.",
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

  async function syncNow() {
    setSyncBusy(true);
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: onSync,
          catch: () => ({ _tag: "NativeSyncRequestError" }) as const,
        }),
      ),
    );
    setSyncBusy(false);
    setNotice(
      Either.isRight(result) ? result.right : "Sync failed. Your offline data is still saved.",
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

  return (
    <View style={styles.panel} testID="native-account-panel">
      <View style={styles.heading}>
        <Text style={styles.title}>{cloudAvailable ? "Cloud account" : "Local data"}</Text>
        {account ? <Text style={styles.signedIn}>{account}</Text> : null}
      </View>
      {!cloudAvailable && (
        <Text style={styles.notice}>
          Cloud sign-in and sync are not configured on this device. Study, edit cards and transfer
          private backups locally.
        </Text>
      )}
      {onImportDelimited || onExportDelimited ? (
        <>
          <Text style={styles.notice}>
            CSV/TSV transfers questions, answers, tags and objective labels. Schedules, review
            history and attachments are excluded. Use an area package for attachments or a private
            backup for schedules and review history.
          </Text>
          {(["csv", "tsv"] as const).map((format) => (
            <View key={format} style={styles.fileActions}>
              {onImportDelimited ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={fileBusy}
                  onPress={() => void runFileAction(() => onImportDelimited(format))}
                  style={styles.fileButton}
                >
                  <Text style={styles.fileButtonText}>Import {format.toUpperCase()}</Text>
                </Pressable>
              ) : null}
              {onExportDelimited ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={fileBusy}
                  onPress={() => void runFileAction(() => onExportDelimited(format))}
                  style={styles.fileButton}
                >
                  <Text style={styles.fileButtonText}>Export {format.toUpperCase()}</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
      <View style={styles.fileActions}>
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => void runFileAction(onImport)}
          style={styles.fileButton}
        >
          <Text style={styles.fileButtonText}>{fileBusy ? "Working…" : "Import area or ZIP"}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => void runFileAction(onExport)}
          style={styles.fileButton}
        >
          <Text style={styles.fileButtonText}>Export area package</Text>
        </Pressable>
      </View>
      <View style={styles.fileActions}>
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => void runFileAction(onBackupRestore)}
          style={styles.fileButton}
        >
          <Text style={styles.fileButtonText}>Restore private backup</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => void runFileAction(onBackupExport)}
          style={styles.fileButton}
        >
          <Text style={styles.fileButtonText}>Export private backup</Text>
        </Pressable>
      </View>
      {cloudAvailable && ownershipIssue ? (
        <View style={styles.conflict}>
          <Text style={styles.conflictTitle}>
            {ownershipIssue === "account-mismatch"
              ? "Workspace belongs to another account"
              : "Confirm this workspace’s cloud account"}
          </Text>
          <Text style={styles.notice}>
            {ownershipIssue === "account-mismatch"
              ? "Sync is blocked. Keep studying offline, sign back in to its owner, or export a private backup before starting a fresh workspace for this account."
              : "Older sync data has no recorded owner. Only continue if the current account owns its existing cloud areas and review history."}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={fileBusy}
            onPress={() => void runFileAction(onBackupExport)}
            style={styles.fileButton}
          >
            <Text style={styles.fileButtonText}>Export private backup</Text>
          </Pressable>
          {ownershipIssue === "owner-adoption-required" && onAdoptLegacyOwner ? (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={syncBusy}
                onPress={() => setConfirmOwnership(!confirmOwnership)}
                style={styles.buttonSoft}
              >
                <Text style={styles.buttonSoftText}>I own this workspace with this account</Text>
              </Pressable>
              {confirmOwnership ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={syncBusy}
                  onPress={() => {
                    setConfirmOwnership(false);
                    void runFileAction(onAdoptLegacyOwner);
                  }}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Confirm account and sync</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {onResetForAccount ? (
            <Pressable
              accessibilityRole="button"
              disabled={syncBusy || fileBusy}
              onPress={onResetForAccount}
              style={styles.buttonSoft}
            >
              <Text style={styles.buttonSoftText}>Start a fresh local workspace</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {cloudAvailable && account ? (
        <>
          <Pressable
            accessibilityRole="button"
            disabled={syncBusy || resolvingConflict || ownershipIssue !== null}
            onPress={() => void syncNow()}
            style={styles.button}
          >
            {syncBusy ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <Text style={styles.buttonText}>Sync now</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={fileBusy}
            onPress={() => void runFileAction(onExportAccount)}
            style={styles.fileButton}
          >
            <Text style={styles.fileButtonText}>Export account data</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={busy || syncBusy || resolvingConflict}
            onPress={() => void signOut()}
            style={styles.buttonSoft}
          >
            {busy ? (
              <ActivityIndicator color={palette.darkGreen} />
            ) : (
              <Text style={styles.buttonSoftText}>Sign out</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={fileBusy || syncBusy || resolvingConflict}
            onPress={() => setShowDelete(true)}
            style={styles.dangerButton}
          >
            <Text style={styles.dangerButtonText}>Delete account</Text>
          </Pressable>
          {conflictAreas ? (
            <View style={styles.conflict}>
              <Text style={styles.conflictTitle}>Server version is ready to review</Text>
              <Text style={styles.notice}>
                {conflictAreas.length
                  ? conflictAreas.join(" · ")
                  : "All learning areas were deleted on the server."}
              </Text>
              <Text style={styles.notice}>
                Loading it replaces local area content and keeps review history.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={resolvingConflict || syncBusy}
                onPress={() => void applyServerVersion()}
                style={styles.buttonSoft}
              >
                {resolvingConflict ? (
                  <ActivityIndicator color={palette.darkGreen} />
                ) : (
                  <Text style={styles.buttonSoftText}>Use server version</Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </>
      ) : cloudAvailable ? (
        <View style={styles.form}>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={email}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || email.trim().length === 0}
            onPress={() => void requestLink()}
            style={styles.button}
          >
            {busy ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <Text style={styles.buttonText}>Email sign-in link</Text>
            )}
          </Pressable>
        </View>
      ) : null}
      {cloudAvailable && showDelete ? (
        <View style={styles.deleteConfirm}>
          <Text style={styles.conflictTitle}>Delete your account and data?</Text>
          <Text style={styles.notice}>
            This removes synced account data and this device’s workspace and attachments. Signing
            out alone keeps offline data. Export account data first if you need a copy.
          </Text>
          <Text style={styles.notice}>Type DELETE to confirm.</Text>
          <TextInput
            accessibilityLabel="Type DELETE to confirm account deletion"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!fileBusy}
            onChangeText={setDeleteConfirmation}
            value={deleteConfirmation}
            style={styles.input}
          />
          <View style={styles.fileActions}>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy}
              onPress={() => {
                setShowDelete(false);
                setDeleteConfirmation("");
              }}
              style={styles.fileButton}
            >
              <Text style={styles.fileButtonText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy || deleteConfirmation !== "DELETE"}
              onPress={() => void deleteAccount()}
              style={styles.dangerButton}
            >
              <Text style={styles.dangerButtonText}>
                {fileBusy ? "Deleting…" : "Delete account and data"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {notice ? (
        <Text accessibilityRole="alert" style={styles.notice}>
          {notice}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: 10,
    padding: 14,
    backgroundColor: palette.surface,
    borderTopColor: palette.line,
    borderTopWidth: 1,
  },
  heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { color: palette.ink, fontSize: 15, fontWeight: "700" },
  signedIn: { color: palette.darkGreen, fontSize: 12 },
  form: { flexDirection: "row", gap: 8 },
  input: {
    flex: 1,
    minHeight: 42,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: palette.paper,
    color: palette.ink,
  },
  button: {
    minHeight: 42,
    justifyContent: "center",
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: palette.darkGreen,
  },
  buttonText: { color: palette.surface, fontWeight: "700", fontSize: 12 },
  conflict: { gap: 7, padding: 10, borderRadius: 10, backgroundColor: palette.paper },
  fileActions: { flexDirection: "row", gap: 8 },
  fileButton: {
    flex: 1,
    minHeight: 38,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: palette.paper,
  },
  fileButtonText: { color: palette.darkGreen, fontWeight: "700", fontSize: 12 },
  conflictTitle: { color: palette.ink, fontWeight: "700", fontSize: 13 },
  buttonSoft: {
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: palette.green,
  },
  buttonSoftText: { color: palette.darkGreen, fontWeight: "700", fontSize: 12 },
  dangerButton: {
    minHeight: 40,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "#FCE8E5",
  },
  dangerButtonText: { color: "#A5281B", fontWeight: "700", fontSize: 12 },
  deleteConfirm: { gap: 9, padding: 12, borderRadius: 10, backgroundColor: "#FFF5F2" },
  notice: { color: palette.muted, fontSize: 12 },
});
