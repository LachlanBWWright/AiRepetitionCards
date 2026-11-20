import { NativeCollapsibleTrigger, NativeCollapsibleContent } from "@recall/ui-native";
import { NativeButton } from "@recall/ui-native";

import { useState } from "react";
import { Text, View } from "react-native";

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
    <View className="flex-row gap-2">
      {onImport && (
        <NativeButton
          label={`Import ${format.toUpperCase()}`}
          variant="secondary"

          disabled={fileBusy}
          onPress={() => {
            runFileAction(() => onImport(format));
          }}
          className="flex-1"
        />
      )}
      {onExport && (
        <NativeButton
          label={`Export ${format.toUpperCase()}`}
          variant="secondary"

          disabled={fileBusy}
          onPress={() => {
            runFileAction(() => onExport(format));
          }}
          className="flex-1"
        />
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
      <NativeButton
        label="I own this workspace with this account"
        selected={confirmOwnership}
        variant="secondary"
        disabled={syncBusy}
        onPress={() => {
          setConfirmOwnership(!confirmOwnership);
        }}
      />
      {confirmOwnership ? (
        <NativeButton
          label="Confirm account and sync"
          variant="default"
          disabled={syncBusy}
          onPress={onConfirm}
        />
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
      <NativeCollapsibleTrigger
        open={showTransfers}
        title="Import, export and backups"
        onToggle={() => {
          setShowTransfers((value) => !value);
        }}
      />
      <NativeCollapsibleContent open={showTransfers}>
        <View className="gap-4 pb-3">
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
          <View className="flex-row gap-2">
            <NativeButton
              label={fileBusy ? "Working…" : "Import area or ZIP"}
              variant="secondary"
              disabled={fileBusy}
              onPress={() => {
                runFileAction(onImport);
              }}
              className="flex-1"
            />
            <NativeButton
              label="Export area package"
              variant="secondary"
              disabled={fileBusy}
              onPress={() => {
                runFileAction(onExport);
              }}
              className="flex-1"
            />
          </View>
          <View className="flex-row gap-2">
            <NativeButton
              label="Restore private backup"
              variant="secondary"
              disabled={fileBusy}
              onPress={() => {
                runFileAction(onBackupRestore);
              }}
              className="flex-1"
            />
            <NativeButton
              label="Export private backup"
              variant="secondary"
              disabled={fileBusy}
              onPress={() => {
                runFileAction(onBackupExport);
              }}
              className="flex-1"
            />
          </View>
        </View>
      </NativeCollapsibleContent>
      {ownershipIssue ? (
        <View className="gap-4 py-4 border-t border-recall-line">
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
          <NativeButton
            label="Export private backup"
            variant="secondary"
            disabled={fileBusy}
            onPress={() => {
              runFileAction(onBackupExport);
            }}
            className="flex-1"
          />
          {ownershipIssue === "owner-adoption-required" && onAdoptLegacyOwner ? (
            <OwnerAdoptionControls
              syncBusy={syncBusy}
              confirmOwnership={confirmOwnership}
              setConfirmOwnership={setConfirmOwnership}
              onConfirm={confirmAdoption}
            />
          ) : null}
          {onResetForAccount ? (
            <NativeButton
              label="Start a fresh local workspace"
              variant="secondary"
              disabled={syncBusy || fileBusy}
              onPress={onResetForAccount}
            />
          ) : null}
        </View>
      ) : null}
    </>
  );
}
