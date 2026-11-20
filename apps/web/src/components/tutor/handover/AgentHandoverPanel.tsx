import { useId } from "react";
import { AGENT_TASKS, MAX_AGENT_JSON_BYTES, type AgentChangePreview } from "@recall/application";
import { useAgentHandover, type AgentHandoverProps, type AgentHandoverModel } from "@recall/react";
import {
  Button,
  Textarea,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
  Checkbox,
} from "@recall/ui-web";
import { Label } from "@recall/ui-web/components/label";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@recall/ui-web/components/accordion";

function Choice({
  label,
  checked,
  onChange,
  disabled,
}: {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        onCheckedChange={(value) => {
          onChange(value === true);
        }}
        disabled={disabled}
      />
      <Label htmlFor={id}>{label}</Label>
    </div>
  );
}
function ChangeItem({
  change,
  value,
}: {
  readonly change: AgentChangePreview;
  readonly value: string;
}) {
  return (
    <AccordionItem value={value}>
      <AccordionTrigger>{change.title}</AccordionTrigger>
      <AccordionContent>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="font-medium">Before</p>
            <pre className="whitespace-pre-wrap break-words text-xs">
              {change.before ?? "New content"}
            </pre>
          </div>
          <div>
            <p className="font-medium">After</p>
            <pre className="whitespace-pre-wrap break-words text-xs">
              {change.after ?? "Deleted (review history preserved)"}
            </pre>
          </div>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
function ChangePreview({ model }: { readonly model: AgentHandoverModel }) {
  if (!model.preview) return null;
  return (
    <div className="space-y-4" aria-label="Proposed changes">
      <Accordion type="multiple">
        {model.preview.changes.map((change, index) => (
          <ChangeItem key={index} change={change} value={String(index)} />
        ))}
      </Accordion>
      {model.preview.changes.some((change) => change.destructive) && (
        <Choice
          label="I approve the listed deletions"
          checked={model.allowDeletion}
          onChange={model.setAllowDeletion}
          disabled={model.busy}
        />
      )}
      <Button
        onClick={model.apply}
        disabled={
          model.busy ||
          (model.preview.changes.some((change) => change.destructive) && !model.allowDeletion)
        }
      >
        Apply approved changes
      </Button>
    </div>
  );
}
function CardChoices({ model }: { readonly model: AgentHandoverModel }) {
  const id = useId();
  return (
    <div className="max-h-48 space-y-3 overflow-y-auto">
      <Label htmlFor={id}>Find cards to include</Label>
      <Input
        id={id}
        value={model.cardQuery}
        onChange={(event) => {
          model.setCardQuery(event.target.value);
        }}
        disabled={model.busy}
      />
      <p className="text-xs text-muted-foreground">
        Showing up to 100 matches. Search by question or card ID. {model.cardIds.length} selected.
      </p>
      {model.cardChoices.map((card) => (
        <Choice
          key={card.id}
          label={card.front}
          checked={model.cardIds.includes(card.id)}
          onChange={() => {
            model.toggleCard(card.id);
          }}
          disabled={model.busy}
        />
      ))}
    </div>
  );
}
function HandoverOutput({
  model,
  id,
}: {
  readonly model: AgentHandoverModel;
  readonly id: string;
}) {
  return (
    <div className="space-y-3">
      <Label htmlFor={`${id}-output`}>Handover JSON</Label>
      <Textarea
        id={`${id}-output`}
        data-testid="agent-handover-output"
        readOnly
        value={model.output}
        rows={7}
        className="font-mono text-xs"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            model.transfer("copy");
          }}
          disabled={model.busy}
        >
          Copy handover
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            model.transfer("save");
          }}
          disabled={model.busy}
        >
          Save JSON
        </Button>
      </div>
    </div>
  );
}
export function AgentHandoverPanel(props: AgentHandoverProps) {
  const model = useAgentHandover(props);
  const id = useId();
  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Discuss your deck with any external AI. Copy the handover, chat there, then say “prepare
        changes” and paste its JSON here. No connected AI account is required.
      </p>
      <section className="space-y-4" aria-label="Copy for external AI">
        <h3 className="font-semibold">Copy for external AI · {model.area?.title}</h3>
        <Label htmlFor={`${id}-task`}>Task</Label>
        <Select value={model.task} onValueChange={model.setTaskValue} disabled={model.busy}>
          <SelectTrigger id={`${id}-task`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGENT_TASKS.map((task) => (
              <SelectItem key={task.value} value={task.value}>
                {task.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor={`${id}-goal`}>Your goal, question or mistaken answer</Label>
        <Textarea
          id={`${id}-goal`}
          value={model.goal}
          onChange={(event) => {
            model.setGoal(event.target.value);
          }}
          maxLength={10_000}
          disabled={model.busy}
        />
        <Choice
          label="Include all cards in this deck"
          checked={model.allCards}
          onChange={model.setAllCards}
          disabled={model.busy}
        />
        {!model.allCards && <CardChoices model={model} />}
        <Choice
          label={`Include recent tutor conversation (${String(Math.min(20, props.conversation?.length ?? 0))} messages)`}
          checked={model.includeConversation}
          onChange={model.setIncludeConversation}
          disabled={model.busy || !props.conversation?.length}
        />
        <Choice
          label="Include recent review history (up to 20 ratings)"
          checked={model.includeReviews}
          onChange={model.setIncludeReviews}
          disabled={model.busy}
        />
        <p className="text-xs text-muted-foreground">
          Only selected card text, objectives and opted-in history are exported. Attachments and
          account credentials are excluded. Inspect the handover before sharing.
        </p>
        <Button onClick={model.build} disabled={model.busy}>
          Prepare handover
        </Button>
        {model.output && <HandoverOutput model={model} id={id} />}
      </section>
      <section className="space-y-4" aria-label="Review AI changes">
        <h3 className="font-semibold">Review AI changes</h3>
        <Label htmlFor={`${id}-input`}>Paste the agent’s change-proposal JSON</Label>
        <Textarea
          id={`${id}-input`}
          value={model.input}
          onChange={(event) => {
            model.setInput(event.target.value);
          }}
          maxLength={MAX_AGENT_JSON_BYTES}
          rows={6}
          className="font-mono text-xs"
          disabled={model.busy}
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={model.pick} disabled={model.busy}>
            Open JSON
          </Button>
          <Button onClick={model.review} disabled={model.busy || !model.input.trim()}>
            Validate and preview
          </Button>
        </div>
        <ChangePreview model={model} />
      </section>
      {model.status && (
        <p role="status" className="text-sm">
          {model.status}
        </p>
      )}
    </div>
  );
}
