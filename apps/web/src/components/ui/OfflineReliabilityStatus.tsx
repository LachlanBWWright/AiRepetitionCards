import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { StatusBadge } from "./StatusBadge";

export type OfflinePersistenceStatus =
  "saved-locally" | "synchronized" | "awaiting-sync" | "conflicted";

export function OfflineReliabilityStatus({
  status,
  storageLocation = "device",
  durableEnabled,
  onDurableChange,
  onRetry,
  quiet = false,
}: {
  readonly quiet?: boolean;
  readonly status: OfflinePersistenceStatus;
  readonly storageLocation?: "tab" | "device" | "native";
  readonly durableEnabled?: boolean;
  readonly onDurableChange?: (enabled: boolean) => void;
  readonly onRetry?: () => void;
}) {
  const label =
    status === "saved-locally"
      ? storageLocation === "tab"
        ? "Saved in this tab"
        : "Saved locally"
      : status === "synchronized"
        ? "Synchronized"
        : status === "awaiting-sync"
          ? "Awaiting sync"
          : "Conflicted";
  const tone =
    status === "saved-locally" || status === "synchronized"
      ? "success"
      : status === "awaiting-sync"
        ? "warning"
        : "danger";
  return (
    <div className="flex flex-wrap items-center gap-2" aria-live="polite">
      {quiet && (status === "saved-locally" || status === "synchronized") ? (
        <span className="text-xs text-muted-foreground">{label}</span>
      ) : (
        <StatusBadge tone={tone}>{label}</StatusBadge>
      )}
      {onDurableChange && (
        <div className="flex items-center gap-2 text-sm text-[var(--ink-muted)]">
          <Checkbox
            checked={durableEnabled === true}
            aria-label="Keep drafts on this device"
            onCheckedChange={(checked) => {
              onDurableChange(checked === true);
            }}
          />
          <span>Keep drafts on this device</span>
        </div>
      )}
      {status !== "saved-locally" && status !== "synchronized" && onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
