import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { NativeButton } from "../ui/NativeButton";

type LibraryTransfer = "export" | "backup";

interface AppLibraryTransferProps {
  readonly activeAreaTitle: string | undefined;
  readonly canExport: boolean;
  readonly transfer: LibraryTransfer | null;
  readonly importChoicesOpen: boolean;
  readonly transferPending: boolean;
  readonly importingCards: boolean;
  readonly reviewPending: boolean;
  readonly message: string | null;
  readonly portableDeckTransfer: ReactNode;
  readonly onOpenTransfer: (transfer: LibraryTransfer) => void;
  readonly onCloseTransfer: () => void;
  readonly onCloseImportChoices: () => void;
  readonly onImportAnki: () => void;
  readonly onImportCards: (format?: "csv" | "tsv") => void;
  readonly onRunTransfer: (action: () => Promise<string>) => void;
  readonly onExportActiveArea: (format?: "csv" | "tsv") => Promise<string>;
  readonly onExportPrivateBackup: () => Promise<string>;
  readonly onRestorePrivateBackup: () => Promise<string>;
}

export function AppLibraryTransfer({
  activeAreaTitle,
  canExport,
  transfer,
  importChoicesOpen,
  transferPending,
  importingCards,
  reviewPending,
  message,
  portableDeckTransfer,
  onOpenTransfer,
  onCloseTransfer,
  onCloseImportChoices,
  onImportAnki,
  onImportCards,
  onRunTransfer,
  onExportActiveArea,
  onExportPrivateBackup,
  onRestorePrivateBackup,
}: AppLibraryTransferProps) {
  const runTransfer = (action: () => Promise<string>) => () => {
    onRunTransfer(action);
  };
  const importCards = (format?: "csv" | "tsv") => () => {
    onImportCards(format);
  };
  return (
    <>
      <View className="gap-2">
        <NativeButton
          label="Export deck"
          tone="soft"
          disabled={reviewPending || !canExport || transferPending}
          onPress={() => {
            onOpenTransfer("export");
          }}
        />
        <NativeButton
          label="Workspace backup"
          tone="soft"
          disabled={reviewPending || transferPending}
          onPress={() => {
            onOpenTransfer("backup");
          }}
        />
      </View>
      {transfer && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          <Text className="text-lg font-bold">
            {transfer === "export" ? "Export deck" : "Workspace backup"}
          </Text>
          <Text className="text-sm text-recall-muted">
            {transfer === "export"
              ? `Export ${activeAreaTitle ?? "the selected deck"}. CSV/TSV contains text and tags; deck packages also include attachments. Reviews stay private.`
              : "Backups include decks, schedules, review history and attachments. Restoring replaces the workspace. Drafts and editing flags are stored separately."}
          </Text>
          {transfer === "export" ? (
            <>
              {portableDeckTransfer}
              <NativeButton
                label="Export CSV"
                disabled={transferPending}
                onPress={runTransfer(() => onExportActiveArea("csv"))}
              />
              <NativeButton
                label="Export TSV"
                tone="soft"
                disabled={transferPending}
                onPress={runTransfer(() => onExportActiveArea("tsv"))}
              />
              <NativeButton
                label="Export deck package"
                tone="soft"
                disabled={transferPending}
                onPress={runTransfer(() => onExportActiveArea())}
              />
            </>
          ) : (
            <>
              <NativeButton
                label="Save workspace backup"
                disabled={transferPending}
                onPress={runTransfer(onExportPrivateBackup)}
              />
              <NativeButton
                label="Restore workspace backup"
                tone="soft"
                disabled={transferPending}
                onPress={runTransfer(onRestorePrivateBackup)}
              />
            </>
          )}
          {message && <Text accessibilityRole="alert">{message}</Text>}
          <NativeButton
            label="Close file tools"
            tone="soft"
            disabled={transferPending}
            onPress={onCloseTransfer}
          />
        </View>
      )}
      {importChoicesOpen && (
        <View className="gap-3 rounded-xl border border-recall-line p-4">
          {portableDeckTransfer}
          <Text className="text-lg font-bold text-recall-ink">Import cards</Text>
          <Text className="text-sm text-recall-muted">
            Imports are validated and added as a separate deck. Review the destination and card
            count before saving.
          </Text>
          <NativeButton
            label="Import Anki deck"
            disabled={importingCards || reviewPending}
            onPress={onImportAnki}
          />
          <NativeButton
            label="Import CSV"
            tone="soft"
            disabled={importingCards || reviewPending}
            onPress={importCards("csv")}
          />
          <NativeButton
            label="Import TSV"
            tone="soft"
            disabled={importingCards || reviewPending}
            onPress={importCards("tsv")}
          />
          <NativeButton
            label="Import deck package"
            tone="soft"
            disabled={importingCards || reviewPending}
            onPress={importCards()}
          />
          <NativeButton
            label="Close import"
            tone="soft"
            disabled={importingCards}
            onPress={onCloseImportChoices}
          />
          {message && (
            <Text accessibilityRole="alert" className="text-sm text-recall-muted">
              {message}
            </Text>
          )}
        </View>
      )}
    </>
  );
}
