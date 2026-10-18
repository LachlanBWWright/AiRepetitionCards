import { useState } from "react";
import { Pressable, Text, View } from "react-native";

type TransferFormat = "csv" | "tsv";

function DelimitedFormatActions({
  format,
  fileBusy,
  onImport,
  onExport,
  runFileAction,
}: {
  readonly format: TransferFormat;
  readonly fileBusy: boolean;
  readonly onImport: ((format: TransferFormat) => Promise<string>) | undefined;
  readonly onExport: ((format: TransferFormat) => Promise<string>) | undefined;
  readonly runFileAction: (action: () => Promise<string>) => void;
}) {
  return (
    <View className="flex-row gap-[8px]">
      {onImport && (
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => {
            runFileAction(() => onImport(format));
          }}
          className="flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
        >
          <Text className="text-recall-darkGreen font-bold text-[12px]">
            Import {format.toUpperCase()}
          </Text>
        </Pressable>
      )}
      {onExport && (
        <Pressable
          accessibilityRole="button"
          disabled={fileBusy}
          onPress={() => {
            runFileAction(() => onExport(format));
          }}
          className="flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
        >
          <Text className="text-recall-darkGreen font-bold text-[12px]">
            Export {format.toUpperCase()}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

function DelimitedFormatActionsGroup({
  fileBusy,
  onImport,
  onExport,
  runFileAction,
}: Omit<Parameters<typeof DelimitedFormatActions>[0], "format">) {
  return (
    <>
      {(["csv", "tsv"] as const).map((format) => (
        <DelimitedFormatActions
          key={format}
          format={format}
          fileBusy={fileBusy}
          onImport={onImport}
          onExport={onExport}
          runFileAction={runFileAction}
        />
      ))}
    </>
  );
}

function OwnerAdoptionControls({
  syncBusy,
  confirmOwnership,
  setConfirmOwnership,
  onConfirm,
}: {
  readonly syncBusy: boolean;
  readonly confirmOwnership: boolean;
  readonly setConfirmOwnership: (value: boolean) => void;
  readonly onConfirm: () => void;
}) {
  return (
    <>
      <Pressable
        accessibilityRole="button"
        disabled={syncBusy}
        onPress={() => {
          setConfirmOwnership(!confirmOwnership);
        }}
        className="min-h-[40px] justify-center items-center px-[12px] border-b border-recall-line"
      >
        <Text className="text-recall-darkGreen font-bold text-[12px]">
          I own this workspace with this account
        </Text>
      </Pressable>
      {confirmOwnership ? (
        <Pressable
          accessibilityRole="button"
          disabled={syncBusy}
          onPress={onConfirm}
          className="min-h-[42px] justify-center px-[14px] rounded-[10px] bg-recall-darkGreen"
        >
          <Text className="text-recall-surface font-bold text-[12px]">
            Confirm account and sync
          </Text>
        </Pressable>
      ) : null}
    </>
  );
}

export function NativeAccountPanelTransfers({
  fileBusy,
  syncBusy,
  ownershipIssue,
  onAdoptLegacyOwner,
  onResetForAccount,
  onImport,
  onExport,
  onImportDelimited,
  onExportDelimited,
  onBackupRestore,
  onBackupExport,
  runFileAction,
}: {
  readonly fileBusy: boolean;
  readonly syncBusy: boolean;
  readonly ownershipIssue: "account-mismatch" | "owner-adoption-required" | null;
  readonly onAdoptLegacyOwner: (() => Promise<string>) | undefined;
  readonly onResetForAccount: (() => void) | undefined;
  readonly onImport: () => Promise<string>;
  readonly onExport: () => Promise<string>;
  readonly onImportDelimited: ((format: TransferFormat) => Promise<string>) | undefined;
  readonly onExportDelimited: ((format: TransferFormat) => Promise<string>) | undefined;
  readonly onBackupRestore: () => Promise<string>;
  readonly onBackupExport: () => Promise<string>;
  readonly runFileAction: (action: () => Promise<string>) => void;
}) {
  const [showTransfers, setShowTransfers] = useState(false);
  const [confirmOwnership, setConfirmOwnership] = useState(false);
  const confirmAdoption = () => {
    if (!onAdoptLegacyOwner) return;
    setConfirmOwnership(false);
    runFileAction(onAdoptLegacyOwner);
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showTransfers }}
        onPress={() => {
          setShowTransfers((value) => !value);
        }}
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
              <DelimitedFormatActionsGroup
                fileBusy={fileBusy}
                onImport={onImportDelimited}
                onExport={onExportDelimited}
                runFileAction={runFileAction}
              />
            </>
          ) : null}
          <View className={"flex-row gap-[8px]"}>
            <Pressable
              accessibilityRole="button"
              disabled={fileBusy}
              onPress={() => {
                runFileAction(onImport);
              }}
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
              onPress={() => {
                runFileAction(onExport);
              }}
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
              onPress={() => {
                runFileAction(onBackupRestore);
              }}
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
              onPress={() => {
                runFileAction(onBackupExport);
              }}
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
      {ownershipIssue ? (
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
            onPress={() => {
              runFileAction(onBackupExport);
            }}
            className={
              "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line"
            }
          >
            <Text className={"text-recall-darkGreen font-bold text-[12px]"}>
              Export private backup
            </Text>
          </Pressable>
          {ownershipIssue === "owner-adoption-required" && onAdoptLegacyOwner ? (
            <OwnerAdoptionControls
              syncBusy={syncBusy}
              confirmOwnership={confirmOwnership}
              setConfirmOwnership={setConfirmOwnership}
              onConfirm={confirmAdoption}
            />
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
    </>
  );
}
