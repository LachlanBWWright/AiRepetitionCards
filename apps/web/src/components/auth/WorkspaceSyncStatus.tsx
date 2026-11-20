"use client";
import { Button } from "@/components/ui/Button";
import { useEffect, useState } from "react";
import { describeWorkspaceSyncStatus, type SyncStatusInput } from "@recall/application";
export function WorkspaceSyncStatus(
  input: Omit<SyncStatusInput, "online"> & {
    readonly retry?: (() => void) | undefined;
    readonly onSignInHintChange?: ((visible: boolean) => void) | undefined;
  },
) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => {
      setOnline(navigator.onLine);
    };
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const status = describeWorkspaceSyncStatus({ ...input, online });
  const showSignInHint = !input.signedIn && !status.attention && !input.busy && online;
  const onSignInHintChange = input.onSignInHintChange;
  useEffect(() => {
    onSignInHintChange?.(showSignInHint);
    return () => {
      onSignInHintChange?.(false);
    };
  }, [onSignInHintChange, showSignInHint]);
  if (showSignInHint && onSignInHintChange) return null;
  return (
    <div role="status" className="flex flex-col gap-1 text-xs">
      <strong>{status.label}</strong>
      <p className="text-muted-foreground">{status.detail}</p>
      {input.retry && (
        <Button type="button" variant="default" disabled={input.busy} onClick={input.retry}>
          Retry synchronization
        </Button>
      )}
    </div>
  );
}
