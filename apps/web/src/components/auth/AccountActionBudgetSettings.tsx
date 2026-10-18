import { ChevronDown } from "lucide-react";
import type { LocalBudgetApi } from "@recall/application";
import { Button } from "@/components/ui/Button";
import { BudgetSettingsPanel } from "./BudgetSettingsPanel";

export function AccountActionBudgetSettings({
  accountId,
  api,
  open,
  panelId,
  onToggle,
}: {
  accountId: string;
  api: LocalBudgetApi;
  open: boolean;
  panelId: string;
  onToggle: () => void;
}) {
  return (
    <div className="border-t pt-4">
      <Button
        variant="link"
        type="button"
        className="w-full justify-between px-0 text-foreground no-underline hover:no-underline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        AI budget settings
        <ChevronDown
          aria-hidden="true"
          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </Button>
      <div id={panelId} hidden={!open}>
        {open && <BudgetSettingsPanel key={accountId} api={api} accountId={accountId} />}
      </div>
    </div>
  );
}
