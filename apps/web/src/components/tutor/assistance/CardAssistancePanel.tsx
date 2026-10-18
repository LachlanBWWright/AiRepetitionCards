"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Button } from "@recall/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { ChevronDown, Sparkles } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Effect, Either } from "effect";
import {
  createCardAssistanceTutor,
  inspectCardQuality,
  findCardDuplicates,
  type CardDuplicateCandidate,
  type KnowledgeNotebook,
} from "@recall/application";
import type {
  CardProposal,
  CardRefinementResult,
  CardInspectionResult,
  StudySourcePassage,
} from "@recall/ai-core";
import type { KnowledgeArea } from "@recall/domain";
import { tutorApi } from "@/lib/tutor-api";
import { cardDuplicateAcknowledgementKey } from "../../knowledge/library/duplicates/CardDuplicateWarnings";
import {
  CardAssistancePanelActionButton,
  CardAssistancePanelInstructions,
  type CardAssistanceRefinementAction,
} from "./CardAssistancePanelControls";
import {
  CardAssistancePanelInspection,
  CardAssistancePanelReview,
} from "./CardAssistancePanelReview";

type Failure = { readonly message: string };
export type CardAssistancePanelProps = {
  readonly proposal: CardProposal;
  readonly knowledgeArea: KnowledgeArea;
  readonly api?: typeof tutorApi;
  readonly notebook?: KnowledgeNotebook;
  readonly saveNotebook?: (value: KnowledgeNotebook) => Effect.Effect<KnowledgeNotebook, Failure>;
  readonly disabled?: boolean;
  readonly clock?: () => number;
  readonly networkDisabled?: boolean;
  readonly onBusyChange?: (busy: boolean) => void;
  readonly existingCard?: boolean;
  readonly sources?: readonly StudySourcePassage[];
  readonly duplicateCandidates?: readonly CardDuplicateCandidate[];
  readonly excludeCardId?: string;
  readonly onApply: (result: CardRefinementResult, mode: "wording" | "replace") => Promise<boolean>;
  readonly initialRefinement?: CardRefinementResult;
  readonly initialInspection?: CardInspectionResult;
};

export function CardAssistancePanel({
  proposal,
  knowledgeArea,
  api = tutorApi,
  notebook,
  saveNotebook,
  disabled = false,
  clock = Date.now,
  networkDisabled = false,
  onBusyChange,
  existingCard = false,
  onApply,
  initialRefinement,
  initialInspection,
  sources = [],
  duplicateCandidates = [],
  excludeCardId,
}: CardAssistancePanelProps) {
  const [acknowledgedDuplicates, setAcknowledgedDuplicates] = useState<readonly string[]>([]);
  const [expanded, setExpanded] = useState(Boolean(initialRefinement || initialInspection));
  const [instruction, setInstruction] = useState("");
  const [refinement, setRefinement] = useState(initialRefinement ?? null);
  const refinementCandidates = refinement
    ? refinement.cards.map((card, index) => ({
        id: `refinement-${String(index)}`,
        front: card.front,
        back: card.back,
      }))
    : [];
  const duplicatesApproved =
    refinement?.cards.every((card, index) => {
      const candidates = [
        ...duplicateCandidates.filter((candidate) => candidate.id !== excludeCardId),
        ...refinementCandidates.filter(
          (candidate) => candidate.id !== `refinement-${String(index)}`,
        ),
      ];
      return (
        findCardDuplicates(card, candidates).length === 0 ||
        acknowledgedDuplicates.includes(cardDuplicateAcknowledgementKey(card, candidates))
      );
    }) ?? true;
  const [inspection, setInspection] = useState(initialInspection ?? null);
  const [baseline, setBaseline] = useState(proposal);
  const [inspectionBaseline, setInspectionBaseline] = useState(proposal);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const working = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const findings = Effect.runSync(Effect.either(inspectCardQuality(proposal)));
  const stale =
    baseline.front !== proposal.front ||
    baseline.back !== proposal.back ||
    baseline.objectiveId !== proposal.objectiveId;
  function run(operation: Effect.Effect<void, Failure>) {
    if (disabled || working.current) return;
    working.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setMessage(null);
    void Effect.runPromise(Effect.either(operation)).then((result) => {
      onBusyChange?.(false);
      if (!alive.current) return;
      if (Either.isLeft(result)) setMessage(result.left.message);
      working.current = false;
      setBusy(false);
    });
  }
  function refine(action: CardAssistanceRefinementAction) {
    if (networkDisabled) return;
    const tutor = createCardAssistanceTutor(
      api,
      saveNotebook ? (next) => saveNotebook(next).pipe(Effect.asVoid) : undefined,
    );
    run(
      tutor
        .refine(
          notebook ?? null,
          { knowledgeArea, history: [] },
          {
            front: proposal.front,
            back: proposal.back,
            objectiveId: proposal.objectiveId,
            mode: action,
            instructions: instruction,
            sources,
          },
          clock(),
        )
        .pipe(
          Effect.flatMap((value) =>
            Effect.gen(function* () {
              if (value.notebook && saveNotebook) yield* saveNotebook(value.notebook);
              if (!alive.current) return;
              setBaseline(proposal);
              setRefinement(value.result);
            }),
          ),
        ),
    );
  }
  function inspect() {
    if (networkDisabled) return;
    const tutor = createCardAssistanceTutor(
      api,
      saveNotebook ? (next) => saveNotebook(next).pipe(Effect.asVoid) : undefined,
    );
    run(
      tutor
        .inspect(
          notebook ?? null,
          { knowledgeArea, history: [] },
          {
            front: proposal.front,
            back: proposal.back,
            objectiveId: proposal.objectiveId,
            sources,
          },
          clock(),
        )
        .pipe(
          Effect.flatMap((value) =>
            Effect.gen(function* () {
              if (value.notebook && saveNotebook) yield* saveNotebook(value.notebook);
              if (!alive.current) return;
              setInspectionBaseline(proposal);
              setInspection(value.result);
            }),
          ),
        ),
    );
  }
  function applyRefinement(mode: "wording" | "replace") {
    if (!refinement) return;
    run(
      Effect.tryPromise({
        try: () => onApply(refinement, mode),
        catch: () => ({
          message:
            mode === "replace"
              ? "Changes could not be saved. Your original card and suggestion remain available."
              : "The wording update could not be saved.",
        }),
      }).pipe(
        Effect.flatMap((saved) =>
          saved
            ? Effect.sync(() => {
                setRefinement(null);
              })
            : Effect.fail({
                message: "Changes were not saved. Your suggestion remains available to retry.",
              }),
        ),
      ),
    );
  }
  function suggestInstructionChanges() {
    refine("clearer");
  }
  function updateInstruction(event: ChangeEvent<HTMLTextAreaElement>) {
    setInstruction(event.currentTarget.value);
  }
  function updateDuplicateAcknowledgement(key: string, keep: boolean) {
    setAcknowledgedDuplicates((values) =>
      keep
        ? [...values.filter((value) => value !== key), key]
        : values.filter((value) => value !== key),
    );
  }
  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="space-y-3 border-t pt-4"
      aria-label="Card assistance"
    >
      {Either.isRight(findings) && findings.right.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400">
          {findings.right.map((finding, index) => (
            <li key={index}>
              {finding.explanation} {finding.suggestion}
            </li>
          ))}
        </ul>
      )}
      <CollapsibleTrigger asChild>
        <Button
          variant="ghost"
          size="small"
          type="button"
          className="group h-8 gap-2 px-2 text-sm"
          disabled={busy}
        >
          <Sparkles className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Improve with AI
          <ChevronDown
            className="ml-1 size-3.5 text-muted-foreground transition-transform group-data-[state=open]:rotate-180"
            aria-hidden="true"
          />
        </Button>
      </CollapsibleTrigger>
      {Either.isLeft(findings) && (
        <Alert variant="destructive">
          <AlertDescription>{findings.left.message}</AlertDescription>
        </Alert>
      )}
      <CollapsibleContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["clearer", "shorter", "split", "example", "cloze"] as const).map((action) => (
            <CardAssistancePanelActionButton
              key={action}
              action={action}
              disabled={disabled || networkDisabled || busy}
              onRefine={refine}
            />
          ))}
          <Button
            variant="secondary"
            size="small"
            type="button"
            disabled={disabled || networkDisabled || busy}
            onClick={inspect}
          >
            Check quality
          </Button>
        </div>
        <CardAssistancePanelInstructions
          instruction={instruction}
          disabled={disabled || networkDisabled || busy}
          onChange={updateInstruction}
          onSuggest={suggestInstructionChanges}
        />
        {inspection &&
          inspectionBaseline.front === proposal.front &&
          inspectionBaseline.back === proposal.back && (
            <CardAssistancePanelInspection inspection={inspection} />
          )}
        {refinement && (
          <CardAssistancePanelReview
            refinement={refinement}
            baseline={baseline}
            proposal={proposal}
            stale={stale}
            duplicatesApproved={duplicatesApproved}
            existingCard={existingCard}
            disabled={disabled}
            busy={busy}
            duplicateCandidates={duplicateCandidates}
            {...(excludeCardId === undefined ? {} : { excludeCardId })}
            acknowledgedDuplicates={acknowledgedDuplicates}
            refinementCandidates={refinementCandidates}
            onKeepBothChange={updateDuplicateAcknowledgement}
            onApply={applyRefinement}
            onDiscard={() => {
              setRefinement(null);
            }}
          />
        )}
        {busy && (
          <Alert role="status">
            <AlertDescription>Preparing suggestions…</AlertDescription>
          </Alert>
        )}
        {message && (
          <Alert variant="destructive">
            <AlertDescription>{message}</AlertDescription>
          </Alert>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
