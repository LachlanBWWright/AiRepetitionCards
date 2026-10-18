import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { designTokens } from "@recall/design-tokens";

const palette = designTokens.color;
const accountActionClass =
  "flex-1 min-h-[38px] justify-center items-center px-[8px] border-b border-recall-line";

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
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onUseServer}
      className="min-h-[40px] justify-center items-center px-[12px] border-b border-recall-line"
    >
      {resolving ? (
        <ActivityIndicator color={palette.darkGreen} />
      ) : (
        <Text className="text-recall-darkGreen font-bold text-[12px]">Use server version</Text>
      )}
    </Pressable>
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
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={accountActionClass}
    >
      <Text className="text-recall-darkGreen font-bold text-[12px]">{label}</Text>
    </Pressable>
  );
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
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className="min-h-[40px] justify-center items-center px-[12px] border-b border-recall-line"
    >
      {busy ? (
        <ActivityIndicator color={palette.darkGreen} />
      ) : (
        <Text className="text-recall-darkGreen font-bold text-[12px]">{label}</Text>
      )}
    </Pressable>
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
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        onPress={onToggle}
        className="flex-row justify-between items-center min-h-[44px] gap-[12px]"
      >
        <Text className="text-recall-ink text-[15px] font-bold">Account actions</Text>
        <Text className="text-recall-muted text-[12px]">{expanded ? "⌃" : "⌄"}</Text>
      </Pressable>
      {expanded ? (
        <View className="gap-[10px] pb-[12px]">
          <AccountFileAction label="Export account data" disabled={fileBusy} onPress={onExport} />
          <AccountBusyAction
            label="Sign out"
            busy={busy}
            disabled={busy || syncBusy || resolvingConflict}
            onPress={onSignOut}
          />
          <Pressable
            accessibilityRole="button"
            disabled={fileBusy || syncBusy || resolvingConflict}
            onPress={onDelete}
            className="min-h-[40px] justify-center items-center px-[12px] rounded-[10px] bg-[#3a2025]"
          >
            <Text className="text-[#fca5a5] font-bold text-[12px]">Delete account</Text>
          </Pressable>
        </View>
      ) : null}
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
    <View className="gap-[10px] py-[12px] border-t border-recall-line">
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
