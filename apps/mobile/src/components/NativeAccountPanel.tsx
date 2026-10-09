import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
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
  const [showTransfers, setShowTransfers] = useState(false);
  const [showAccountActions, setShowAccountActions] = useState(initialDeleteConfirmationOpen);
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
    <View
      className={"gap-[10px] py-[16px] border-t-recall-line border-t"}
      testID="native-account-panel"
    >
      <View className={"gap-[6px]"}>
        <Text className={"text-recall-ink text-[15px] font-bold"}>
          {cloudAvailable ? "Sign in and sync" : "Files and backups"}
        </Text>
        {account ? <Text className={"text-recall-darkGreen text-[12px]"}>{account}</Text> : null}
      </View>
      {!cloudAvailable && (
        <Text className={"text-recall-muted text-[12px]"}>Sync is unavailable on this device.</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showTransfers }}
        onPress={() => setShowTransfers((value) => !value)}
        className={"flex-row justify-between items-center min-h-[44px] gap-[12px]"}
      >
        <Text className={"text-recall-ink text-[15px] font-bold"}>Import, export and backups</Text>
        <Text className={"text-recall-muted text-[12px]"}>{showTransfers ? "⌃" : "⌄"}</Text>
      </Pressable>
      {showTransfers && (
        <View className={"gap-[10px] pb-[12px]"}>
          {onImportDelimited || onExportDelimited ? (
            <>
              <Text className={"text-recall-muted text-[12px]"}>
                CSV and TSV include card text and tags. Area packages include attachments. Private
                backups also include schedules and review history.
              </Text>
              {(["csv", "tsv"] as const).map((format) => (
                <View key={format} className={"flex-row gap-[8px]"}>
                  {onImportDelimited ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={fileBusy}
                      onPress={() => void runFileAction(() => onImportDelimited(format))}
                      className={
                        "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
                      }
                    >
                      <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                        Import {format.toUpperCase()}
                      </Text>
                    </Pressable>
                  ) : null}
                  {onExportDelimited ? (
                    <Pressable
                      accessibilityRole="button"
                      disabled={fileBusy}
                      onPress={() => void runFileAction(() => onExportDelimited(format))}
                      className={
                        "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
                      }
                    >
                      <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                        Export {format.toUpperCase()}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </>
          ) : null}
          <View className={"flex-row gap-[8px]"}>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy}
              onPress={() => void runFileAction(onImport)}
              className={
                "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
              }
            >
              <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                {fileBusy ? "Working…" : "Import area or ZIP"}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy}
              onPress={() => void runFileAction(onExport)}
              className={
                "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
              }
            >
              <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                Export area package
              </Text>
            </Pressable>
          </View>
          <View className={"flex-row gap-[8px]"}>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy}
              onPress={() => void runFileAction(onBackupRestore)}
              className={
                "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
              }
            >
              <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                Restore private backup
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy}
              onPress={() => void runFileAction(onBackupExport)}
              className={
                "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
              }
            >
              <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                Export private backup
              </Text>
            </Pressable>
          </View>
        </View>
      )}
      {cloudAvailable && ownershipIssue ? (
        <View className={"gap-[10px] py-[12px] border-t border-recall-line"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>
            {ownershipIssue === "account-mismatch"
              ? "Workspace belongs to another account"
              : "Confirm this workspace’s cloud account"}
          </Text>
          <Text className={"text-recall-muted text-[12px]"}>
            {ownershipIssue === "account-mismatch"
              ? "Sync is blocked. Keep studying offline, sign back in to its owner, or export a private backup before starting a fresh workspace for this account."
              : "Older sync data has no recorded owner. Only continue if the current account owns its existing cloud areas and review history."}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={fileBusy}
            onPress={() => void runFileAction(onBackupExport)}
            className={
              "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
            }
          >
            <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
              Export private backup
            </Text>
          </Pressable>
          {ownershipIssue === "owner-adoption-required" && onAdoptLegacyOwner ? (
            <>
              <Pressable
                accessibilityRole="button"
                disabled={syncBusy}
                onPress={() => setConfirmOwnership(!confirmOwnership)}
                className={
                  "min-h-[40px] justify-center items-center px-[12px] border-b border-recall-line"
                }
              >
                <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                  I own this workspace with this account
                </Text>
              </Pressable>
              {confirmOwnership ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={syncBusy}
                  onPress={() => {
                    setConfirmOwnership(false);
                    void runFileAction(onAdoptLegacyOwner);
                  }}
                  className={
                    "min-h-[42px] justify-center px-[14px] rounded-[10px] bg-recall-darkGreen"
                  }
                >
                  <Text className={"text-recall-surface font-bold text-[12px]"}>
                    Confirm account and sync
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
          {onResetForAccount ? (
            <Pressable
              accessibilityRole="button"
              disabled={syncBusy || fileBusy}
              onPress={onResetForAccount}
              className={
                "min-h-[40px] justify-center items-center px-[12px] border-b border-recall-line"
              }
            >
              <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                Start a fresh local workspace
              </Text>
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
            className={"min-h-[42px] justify-center px-[14px] rounded-[10px] bg-recall-darkGreen"}
          >
            {syncBusy ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <Text className={"text-recall-surface font-bold text-[12px]"}>Sync now</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showAccountActions }}
            onPress={() => setShowAccountActions((value) => !value)}
            className={"flex-row justify-between items-center min-h-[44px] gap-[12px]"}
          >
            <Text className={"text-recall-ink text-[15px] font-bold"}>Account actions</Text>
            <Text className={"text-recall-muted text-[12px]"}>
              {showAccountActions ? "⌃" : "⌄"}
            </Text>
          </Pressable>
          {showAccountActions && (
            <View className={"gap-[10px] pb-[12px]"}>
              <Pressable
                accessibilityRole="button"
                disabled={fileBusy}
                onPress={() => void runFileAction(onExportAccount)}
                className={
                  "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
                }
              >
                <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                  Export account data
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy || syncBusy || resolvingConflict}
                onPress={() => void signOut()}
                className={
                  "min-h-[40px] justify-center items-center px-[12px] border-b border-recall-line"
                }
              >
                {busy ? (
                  <ActivityIndicator color={palette.darkGreen} />
                ) : (
                  <Text className={"text-recall-darkGreen font-bold text-[12px]"}>Sign out</Text>
                )}
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={fileBusy || syncBusy || resolvingConflict}
                onPress={() => setShowDelete(true)}
                className={
                  "min-h-[40px] justify-center items-center px-[12px] rounded-[10px] bg-[#3a2025]"
                }
              >
                <Text className={"text-[#fca5a5] font-bold text-[12px]"}>Delete account</Text>
              </Pressable>
            </View>
          )}
          {conflictAreas ? (
            <View className={"gap-[10px] py-[12px] border-t border-recall-line"}>
              <Text className={"text-recall-ink font-bold text-[13px]"}>
                Server version is ready to review
              </Text>
              <Text className={"text-recall-muted text-[12px]"}>
                {conflictAreas.length
                  ? conflictAreas.join(" · ")
                  : "All learning areas were deleted on the server."}
              </Text>
              <Text className={"text-recall-muted text-[12px]"}>
                Loading it replaces local area content and keeps review history.
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={resolvingConflict || syncBusy}
                onPress={() => void applyServerVersion()}
                className={
                  "min-h-[40px] justify-center items-center px-[12px] border-b border-recall-line"
                }
              >
                {resolvingConflict ? (
                  <ActivityIndicator color={palette.darkGreen} />
                ) : (
                  <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
                    Use server version
                  </Text>
                )}
              </Pressable>
            </View>
          ) : null}
        </>
      ) : cloudAvailable ? (
        <View className={"gap-[8px]"}>
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={palette.muted}
            className={
              "flex-1 min-h-[42px] px-[12px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
            value={email}
          />
          <Pressable
            accessibilityRole="button"
            disabled={busy || email.trim().length === 0}
            onPress={() => void requestLink()}
            className={"min-h-[42px] justify-center px-[14px] rounded-[10px] bg-recall-darkGreen"}
          >
            {busy ? (
              <ActivityIndicator color={palette.surface} />
            ) : (
              <Text className={"text-recall-surface font-bold text-[12px]"}>
                Email sign-in link
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
      {cloudAvailable && showDelete ? (
        <View className={"gap-[12px] py-[16px] border-t border-[#fca5a5]"}>
          <Text className={"text-recall-ink font-bold text-[13px]"}>
            Delete your account and data?
          </Text>
          <Text className={"text-recall-muted text-[12px]"}>
            This removes synced account data and this device’s workspace and attachments. Signing
            out alone keeps offline data. Export account data first if you need a copy.
          </Text>
          <Text className={"text-recall-muted text-[12px]"}>Type DELETE to confirm.</Text>
          <TextInput
            accessibilityLabel="Type DELETE to confirm account deletion"
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!fileBusy}
            onChangeText={setDeleteConfirmation}
            value={deleteConfirmation}
            className={
              "flex-1 min-h-[42px] px-[12px] rounded-[10px] bg-recall-paper text-recall-ink"
            }
          />
          <View className={"flex-row gap-[8px]"}>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy}
              onPress={() => {
                setShowDelete(false);
                setDeleteConfirmation("");
              }}
              className={
                "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
              }
            >
              <Text className={"text-recall-darkGreen font-bold text-[12px]"}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy || deleteConfirmation !== "DELETE"}
              onPress={() => void deleteAccount()}
              className={
                "min-h-[40px] justify-center items-center px-[12px] rounded-[10px] bg-[#3a2025]"
              }
            >
              <Text className={"text-[#fca5a5] font-bold text-[12px]"}>
                {fileBusy ? "Deleting…" : "Delete account and data"}
              </Text>
            </Pressable>
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
