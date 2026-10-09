"use client";

import { Alert, AlertDescription } from "@recall/ui-web/components/alert";
import { Label } from "@recall/ui-web/components/label";
import { Button, Textarea } from "@recall/ui-web";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@recall/ui-web/components/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import { useEffect, useRef, useState } from "react";
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
import {
  CardDuplicateWarnings,
  cardDuplicateAcknowledgementKey,
} from "../knowledge/CardDuplicateWarnings";

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
        id: `refinement-${index}`,
        front: card.front,
        back: card.back,
      }))
    : [];
  const duplicatesApproved =
    refinement?.cards.every((card, index) => {
      const candidates = [
        ...duplicateCandidates.filter((candidate) => candidate.id !== excludeCardId),
        ...refinementCandidates.filter((candidate) => candidate.id !== `refinement-${index}`),
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
  function refine(action: "clearer" | "shorter" | "split" | "example" | "cloze") {
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
  return (
    <section className="space-y-4 py-4" aria-label="Card assistance">
      {Either.isRight(findings) && findings.right.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm text-amber-700 dark:text-amber-400">
          {findings.right.map((finding, index) => (
            <li key={index}>
              {finding.explanation} {finding.suggestion}
            </li>
          ))}
        </ul>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" type="button" aria-expanded={expanded} disabled={busy}>
            {expanded ? "Close improvements" : "Request improvements"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => setExpanded(true)}>
            Suggest improvements
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || networkDisabled || busy}
            onSelect={() => {
              setExpanded(true);
              inspect();
            }}
          >
            Check card quality
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {Either.isLeft(findings) && (
        <Alert variant="destructive">
          <AlertDescription>{findings.left.message}</AlertDescription>
        </Alert>
      )}
      {expanded && (
        <div className="space-y-4 py-4">
          <p>
            Send this card{sources.length ? " and its source passages" : ""} to your AI provider for
            suggestions.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            {(["clearer", "shorter", "split", "example", "cloze"] as const).map((action) => (
              <Button
                variant="outline"
                type="button"
                key={action}
                disabled={disabled || networkDisabled || busy}
                onClick={() => refine(action)}
              >
                {action === "clearer"
                  ? "Make clearer"
                  : action === "shorter"
                    ? "Shorten"
                    : action === "split"
                      ? "Split question"
                      : action === "cloze"
                        ? "Convert to cloze"
                        : "Add example"}
              </Button>
            ))}
            <Button
              variant="outline"
              type="button"
              disabled={disabled || networkDisabled || busy}
              onClick={inspect}
            >
              Check quality
            </Button>
          </div>
          <Collapsible>
            <CollapsibleTrigger className="w-full text-left font-medium">
              Custom instructions
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Label>
                Instructions
                <Textarea
                  value={instruction}
                  maxLength={1000}
                  disabled={disabled || networkDisabled || busy}
                  onChange={(event) => setInstruction(event.target.value)}
                  placeholder="Describe how to improve this card…"
                />
              </Label>
              <Button
                variant="outline"
                type="button"
                disabled={disabled || networkDisabled || busy || !instruction.trim()}
                onClick={() => refine("clearer")}
              >
                Suggest changes
              </Button>
            </CollapsibleContent>
          </Collapsible>
          {inspection &&
            inspectionBaseline.front === proposal.front &&
            inspectionBaseline.back === proposal.back && (
              <div>
                <h4 className="text-sm font-semibold">AI quality feedback</h4>
                <p>{inspection.summary}</p>
                {inspection.findings.map((finding, index) => (
                  <p key={index}>
                    {finding.explanation} {finding.suggestion}
                  </p>
                ))}
              </div>
            )}
          {refinement && (
            <div>
              <h4 className="text-sm font-semibold">Review proposed changes</h4>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <h5 className="text-sm font-medium">Original</h5>
                  <p className="whitespace-pre-wrap">{baseline.front}</p>
                  <p className="whitespace-pre-wrap">{baseline.back}</p>
                </div>
                <div>
                  <h5 className="text-sm font-medium">Proposed</h5>
                  {refinement.cards.map((card, index) => (
                    <article key={index}>
                      <strong className="whitespace-pre-wrap">{card.front}</strong>
                      <p className="whitespace-pre-wrap">{card.back}</p>
                      <CardDuplicateWarnings
                        draft={card}
                        candidates={[
                          ...duplicateCandidates.filter(
                            (candidate) => candidate.id !== excludeCardId,
                          ),
                          ...refinementCandidates.filter(
                            (candidate) => candidate.id !== `refinement-${index}`,
                          ),
                        ]}
                        keepBoth={acknowledgedDuplicates.includes(
                          cardDuplicateAcknowledgementKey(card, [
                            ...duplicateCandidates.filter(
                              (candidate) => candidate.id !== excludeCardId,
                            ),
                            ...refinementCandidates.filter(
                              (candidate) => candidate.id !== `refinement-${index}`,
                            ),
                          ]),
                        )}
                        onKeepBothChange={(keep) => {
                          const key = cardDuplicateAcknowledgementKey(card, [
                            ...duplicateCandidates.filter(
                              (candidate) => candidate.id !== excludeCardId,
                            ),
                            ...refinementCandidates.filter(
                              (candidate) => candidate.id !== `refinement-${index}`,
                            ),
                          ]);
                          setAcknowledgedDuplicates((values) =>
                            keep
                              ? [...values.filter((value) => value !== key), key]
                              : values.filter((value) => value !== key),
                          );
                        }}
                        disabled={disabled || busy}
                      />
                      <Collapsible>
                        <CollapsibleTrigger className="w-full text-left font-medium">
                          Why this change · Sources
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p>{card.rationale}</p>
                          {card.sourceReferences.map((reference, referenceIndex) => (
                            <blockquote key={referenceIndex}>
                              {reference.quote}
                              {reference.pageNumber ? ` · page ${reference.pageNumber}` : ""}
                            </blockquote>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    </article>
                  ))}
                </div>
              </div>
              {existingCard && (
                <p>
                  Replacement cards start fresh schedules. Original review history stays intact.
                </p>
              )}
              {stale && (
                <Alert variant="destructive">
                  <AlertDescription>
                    The card changed after this suggestion. Request a new refinement before applying
                    it.
                  </AlertDescription>
                </Alert>
              )}
              <Button
                variant="default"
                type="button"
                disabled={disabled || busy || stale || !duplicatesApproved}
                onClick={() =>
                  run(
                    Effect.tryPromise({
                      try: () => onApply(refinement, "replace"),
                      catch: () => ({
                        message:
                          "Changes could not be saved. Your original card and suggestion remain available.",
                      }),
                    }).pipe(
                      Effect.flatMap((saved) =>
                        saved
                          ? Effect.sync(() => setRefinement(null))
                          : Effect.fail({
                              message:
                                "Changes were not saved. Your suggestion remains available to retry.",
                            }),
                      ),
                    ),
                  )
                }
              >
                {existingCard ? "Approve replacement cards" : "Apply proposed changes"}
              </Button>
              {existingCard &&
                refinement.cards.length === 1 &&
                refinement.cards[0]?.meaningChanged === false &&
                refinement.cards[0].front.includes("{{c") === proposal.front.includes("{{c") && (
                  <Button
                    variant="outline"
                    type="button"
                    disabled={disabled || busy || stale || !duplicatesApproved}
                    onClick={() =>
                      run(
                        Effect.tryPromise({
                          try: () => onApply(refinement, "wording"),
                          catch: () => ({ message: "The wording update could not be saved." }),
                        }).pipe(
                          Effect.flatMap((saved) =>
                            saved
                              ? Effect.sync(() => setRefinement(null))
                              : Effect.fail({
                                  message:
                                    "Changes were not saved. Your suggestion remains available to retry.",
                                }),
                          ),
                        ),
                      )
                    }
                  >
                    Update wording · keep schedule
                  </Button>
                )}
              <Button
                variant="outline"
                type="button"
                disabled={busy}
                onClick={() => setRefinement(null)}
              >
                Discard suggestion
              </Button>
            </div>
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
        </div>
      )}
    </section>
  );
}
