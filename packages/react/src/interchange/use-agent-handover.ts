import { useEffect, useRef, useState } from "react";
import { Effect, Either } from "effect";
import type { Workspace } from "@recall/domain";
import {
  AGENT_TASKS,
  applyWorkspaceAuthoringCommand,
  createAgentHandover,
  parseAgentProposal,
  planAgentChanges,
  type AgentDialogue,
  type AgentFailure,
  type AgentTask,
  type AgentChangePreview,
  type AgentProposal,
  type WorkspaceAuthoringCommand,
} from "@recall/application";

export type AgentTransferPorts = {
  readonly copy: (text: string) => Effect.Effect<void, AgentFailure>;
  readonly save: (text: string) => Effect.Effect<void, AgentFailure>;
  readonly pick: () => Effect.Effect<string | null, AgentFailure>;
};
export type AgentHandoverProps = {
  readonly workspace: Workspace;
  readonly areaId: string;
  readonly conversation?: AgentDialogue | undefined;
  readonly disabled: boolean;
  readonly createId: () => string;
  readonly saveChanges: (command: WorkspaceAuthoringCommand) => Effect.Effect<void, AgentFailure>;
  readonly ports: AgentTransferPorts;
};
export function useAgentHandover(props: AgentHandoverProps) {
  const [task, setTask] = useState<AgentTask>("improve");
  const [goal, setGoal] = useState("");
  const [allCards, setAllCards] = useState(true);
  const [cardQuery, setCardQuery] = useState("");
  const [cardIds, setCardIds] = useState<readonly string[]>([]);
  const [includeConversation, setIncludeConversation] = useState(false);
  const [includeReviews, setIncludeReviews] = useState(false);
  const [output, setOutput] = useState("");
  const [input, setInputState] = useState("");
  const [preview, setPreview] = useState<{
    readonly proposal: AgentProposal;
    readonly changes: readonly AgentChangePreview[];
  } | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [allowDeletion, setAllowDeletion] = useState(false);
  const alive = useRef(false);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = (operation: Effect.Effect<void, AgentFailure>) => {
    if (pending.current || props.disabled) return;
    pending.current = true;
    setBusy(true);
    setStatus("");
    void Effect.runPromise(Effect.either(operation)).then((result) => {
      pending.current = false;
      if (!alive.current) return;
      setBusy(false);
      if (Either.isLeft(result)) setStatus(result.left.message);
    });
  };
  const setInput = (text: string) => {
    setInputState(text);
    setPreview(null);
    setAllowDeletion(false);
    setStatus("");
  };
  const toggleCard = (id: string) => {
    setCardIds((ids) => (ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]));
  };
  const setTaskValue = (value: string) => {
    const next = AGENT_TASKS.find((item) => item.value === value);
    if (next) setTask(next.value);
  };
  const build = () => {
    run(
      Effect.gen(function* () {
        if (!allCards && !cardIds.length)
          return yield* Effect.fail({ message: "Select at least one card or choose all cards." });
        const text = yield* createAgentHandover(props.workspace, {
          handoverId: props.createId(),
          deckIds: [props.areaId],
          ...(allCards ? {} : { cardIds }),
          task,
          goal,
          includeConversation,
          includeReviews,
          conversation: props.conversation ?? [],
        });
        if (alive.current) {
          setOutput(text);
          setStatus("Handover ready. Review the content before sharing it with an external agent.");
        }
      }),
    );
  };
  const transfer = (action: "copy" | "save") => {
    run(
      props.ports[action](output).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (alive.current)
              setStatus(action === "copy" ? "Handover copied." : "Handover file ready.");
          }),
        ),
      ),
    );
  };
  const pick = () => {
    run(
      props.ports.pick().pipe(
        Effect.tap((text) =>
          Effect.sync(() => {
            if (text !== null && alive.current) setInput(text);
          }),
        ),
        Effect.asVoid,
      ),
    );
  };
  const review = () => {
    run(
      Effect.gen(function* () {
        const proposal = yield* parseAgentProposal(input);
        const planned = yield* planAgentChanges(props.workspace, proposal);
        yield* applyWorkspaceAuthoringCommand(
          props.workspace,
          { kind: "apply-agent-changes", proposal },
          new Date(),
        );
        if (alive.current) {
          setPreview({ proposal, changes: planned.preview });
          setAllowDeletion(false);
          setStatus("Review every change below. Nothing has been saved.");
        }
      }),
    );
  };
  const apply = () => {
    if (!preview || (preview.changes.some((change) => change.destructive) && !allowDeletion))
      return;
    run(
      props.saveChanges({ kind: "apply-agent-changes", proposal: preview.proposal }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (!alive.current) return;
            setInputState("");
            setPreview(null);
            setAllowDeletion(false);
            setStatus("Approved changes saved.");
          }),
        ),
      ),
    );
  };
  const area = props.workspace.areas.find((item) => item.id === props.areaId);
  const cardChoices = [];
  const query = cardQuery.trim().toLocaleLowerCase();
  for (const card of area?.cards ?? []) {
    if (cardChoices.length === 100) break;
    if (!query || card.front.toLocaleLowerCase().includes(query) || card.id.includes(query))
      cardChoices.push(card);
  }
  return {
    cardQuery,
    setCardQuery,
    cardChoices,
    task,
    setTaskValue,
    goal,
    setGoal,
    allCards,
    setAllCards,
    cardIds,
    toggleCard,
    includeConversation,
    setIncludeConversation,
    includeReviews,
    setIncludeReviews,
    output,
    input,
    setInput,
    preview,
    status,
    busy: busy || props.disabled,
    allowDeletion,
    setAllowDeletion,
    build,
    transfer,
    pick,
    review,
    apply,
    area,
  };
}
export type AgentHandoverModel = ReturnType<typeof useAgentHandover>;
