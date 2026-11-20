import { useId } from "react";
import { BookOpen, ScanSearch, Scissors, Layers } from "lucide-react";
import { Button } from "@recall/ui-web";
import {
  reviewRepairCopy,
  reviewRepairActions,
  type ReviewRepairAction,
} from "@recall/application";

const icons = { explain: BookOpen, ambiguity: ScanSearch, split: Scissors, prerequisite: Layers };
type Props = {
  readonly disabled: boolean;
  readonly onRequest: (action: ReviewRepairAction) => void;
};
function HelpOption({
  action,
  disabled,
  onRequest,
}: Props & { readonly action: (typeof reviewRepairActions)[number] }) {
  const id = useId();
  const Icon = icons[action.value];
  return (
    <Button
      type="button"
      size="row"
      variant="secondary"
      className="items-start gap-3"
      disabled={disabled}
      aria-label={action.label}
      aria-describedby={id}
      onClick={() => {
        onRequest(action.value);
      }}
    >
      <Icon className="mt-0.5 size-4" aria-hidden="true" />
      <span className="flex min-w-0 flex-col gap-1">
        <span>{action.label}</span>
        <span id={id} className="text-xs font-normal leading-5">
          {action.description}
        </span>
      </span>
    </Button>
  );
}
export function ReviewHelpOptions(props: Props) {
  return (
    <section className="space-y-3" aria-label="Choose card help">
      <h3 className="text-sm font-medium text-muted-foreground">{reviewRepairCopy.options}</h3>
      <div className="grid min-w-0 auto-rows-fr gap-3 sm:grid-cols-2">
        {reviewRepairActions.map((action) => (
          <HelpOption key={action.value} action={action} {...props} />
        ))}
      </div>
    </section>
  );
}
