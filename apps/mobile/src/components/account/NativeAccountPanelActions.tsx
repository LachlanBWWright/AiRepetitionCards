import { NativeCollapsibleTrigger, NativeCollapsibleContent } from "@recall/ui-native";
import { NativeButton } from "@recall/ui-native";

import { Text, View } from "react-native";

export function ServerVersionAction({
  resolving,
  disabled,
  onUseServer,
}: {
  readonly resolving: boolean;
  readonly disabled: boolean;
  readonly onUseServer: () => void;
}) {
  return (
    <NativeButton
      label={resolving ? "Loading server version…" : "Use server version"}
      variant="secondary"
      disabled={disabled}
      onPress={onUseServer}
    />
  );
}

export function AccountFileAction({
  label,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return <NativeButton label={label} variant="secondary" disabled={disabled} onPress={onPress} />;
}

export function AccountBusyAction({
  label,
  busy,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly busy: boolean;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <NativeButton
      label={busy ? "Working…" : label}
      variant="secondary"
      disabled={disabled}
      onPress={onPress}
    />
  );
}

export function AccountActions({
  expanded,
  fileBusy,
  busy,
  syncBusy,
  resolvingConflict,
  onToggle,
  onExport,
  onSignOut,
  onDelete,
}: {
  readonly expanded: boolean;
  readonly fileBusy: boolean;
  readonly busy: boolean;
  readonly syncBusy: boolean;
  readonly resolvingConflict: boolean;
  readonly onToggle: () => void;
  readonly onExport: () => void;
  readonly onSignOut: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <>
      <NativeCollapsibleTrigger open={expanded} title="Account actions" onToggle={onToggle} />
      <NativeCollapsibleContent open={expanded}>
        <View className="gap-4 pb-3">
          <AccountFileAction label="Export account data" disabled={fileBusy} onPress={onExport} />
          <AccountBusyAction
            label="Sign out"
            busy={busy}
            disabled={busy || syncBusy || resolvingConflict}
            onPress={onSignOut}
          />
          <NativeButton
            label="Delete account"
            variant="destructive"
            disabled={fileBusy || syncBusy || resolvingConflict}
            onPress={onDelete}
          />
        </View>
      </NativeCollapsibleContent>
    </>
  );
}

export function AccountConflictNotice({
  areas,
  resolving,
  disabled,
  onUseServer,
}: {
  readonly areas: readonly string[];
  readonly resolving: boolean;
  readonly disabled: boolean;
  readonly onUseServer: () => void;
}) {
  return (
    <View className="gap-4 py-6 border-t border-recall-line">
      <Text className="text-recall-ink font-bold text-[13px]">
        Server version is ready to review
      </Text>
      <Text className="text-recall-muted text-[12px]">
        {areas.length ? areas.join(" · ") : "All decks were deleted on the server."}
      </Text>
      <Text className="text-recall-muted text-[12px]">
        Loading it replaces local area content and keeps review history.
      </Text>
      <ServerVersionAction resolving={resolving} disabled={disabled} onUseServer={onUseServer} />
    </View>
  );
}
