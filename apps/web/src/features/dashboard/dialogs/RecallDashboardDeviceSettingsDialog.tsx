import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@recall/ui-web/components/dialog";
import { DailyReminderSettingsPanel } from "@/components/auth/DailyReminderSettingsPanel";
import { isDesktopRuntime } from "@/lib/desktop-api";
import type { RecallDashboardModel } from "../state/useRecallDashboardController";
export function RecallDashboardDeviceSettingsDialog({
  model,
}: {
  readonly model: RecallDashboardModel;
}) {
  const { deviceSettings, setDeviceSettings, accountMenuTrigger } = model;
  return (
    <Dialog open={deviceSettings} onOpenChange={setDeviceSettings}>
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          accountMenuTrigger.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle id="device-settings-title">Device settings</DialogTitle>
        </DialogHeader>
        <DailyReminderSettingsPanel desktop={isDesktopRuntime()} />
        <DialogFooter>
          <Button
            variant="secondary"
            onClick={() => {
              setDeviceSettings(false);
            }}
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
