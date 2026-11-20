import type { LocalBudgetApi } from "@recall/application";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
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
    <Collapsible className="border-t pt-4" open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger type="button" aria-controls={panelId}>
        AI budget settings
      </CollapsibleTrigger>
      <CollapsibleContent id={panelId}>
        {open && <BudgetSettingsPanel key={accountId} api={api} accountId={accountId} />}
      </CollapsibleContent>
    </Collapsible>
  );
}
