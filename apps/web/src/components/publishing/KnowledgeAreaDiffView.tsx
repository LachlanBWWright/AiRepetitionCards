import type { ReactNode } from "react";
import type { KnowledgeAreaDiff, KnowledgeAreaMetadataChange } from "@recall/application";
import type { KnowledgeArea } from "@recall/domain";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";

type Card = KnowledgeArea["cards"][number];
type Objective = KnowledgeArea["objectives"][number];

const metadataLabels = {
  title: "Title",
  description: "Description",
  language: "Language",
  ai: "AI instructions",
  tags: "Tags",
  licence: "License",
  attribution: "Attribution",
} as const;

function metadataText(value: KnowledgeAreaMetadataChange["before"]): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "string") return value;
  if ("tutorInstructions" in value) {
    return [
      `Tutor: ${value.tutorInstructions || "Not provided"}`,
      `Quiz: ${value.quizInstructions || "Not provided"}`,
      `Card generation: ${value.cardGenerationInstructions || "Not provided"}`,
    ].join("\n");
  }
  return value.length > 0 ? value.join(", ") : "None";
}

function ContentText({ children }: { readonly children: ReactNode }) {
  return <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{children}</p>;
}

function objectiveNames(objectives: readonly Objective[]): ReadonlyMap<string, string> {
  return new Map(
    objectives.flatMap((objective) => [
      [objective.id, objective.title] as const,
      ...(objective.sourceId ? [[objective.sourceId, objective.title] as const] : []),
    ]),
  );
}

function linkedObjectives(ids: readonly string[], names: ReadonlyMap<string, string>): string {
  return ids.map((id) => names.get(id) ?? "Learning objective").join(", ") || "None";
}

function CardContent({
  card,
  names,
}: {
  readonly card: Card;
  readonly names: ReadonlyMap<string, string>;
}) {
  return (
    <div>
      {card.kind === "basic" ? (
        <>
          <strong>Question</strong>
          <ContentText>{card.front}</ContentText>
          <strong>Answer</strong>
          <ContentText>{card.back}</ContentText>
        </>
      ) : (
        <>
          <strong>Cloze text</strong>
          <ContentText>{card.text}</ContentText>
          {card.deletionIndex !== undefined && (
            <ContentText>Selected deletion: c{card.deletionIndex}</ContentText>
          )}
        </>
      )}
      <ContentText>Tags: {card.tags.join(", ") || "None"}</ContentText>
      <ContentText>Objectives: {linkedObjectives(card.objectiveIds, names)}</ContentText>
      {(card.media?.length ?? 0) > 0 && (
        <div>
          <strong>Attachments</strong>
          <ul>
            {card.media?.map((reference) => (
              <li key={reference.id} style={{ overflowWrap: "anywhere" }}>
                {reference.mimeType} · {reference.byteLength.toLocaleString("en-US")} bytes
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ObjectiveContent({
  objective,
  names,
}: {
  readonly objective: Objective;
  readonly names: ReadonlyMap<string, string>;
}) {
  return (
    <div>
      <strong>{objective.title}</strong>
      <ContentText>{objective.description || "No description provided."}</ContentText>
      <ContentText>Prerequisites: {linkedObjectives(objective.prerequisiteIds, names)}</ContentText>
    </div>
  );
}

function ChangeSection({
  title,
  count,
  children,
}: {
  readonly title: string;
  readonly count: number;
  readonly children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Collapsible className="my-3">
      <CollapsibleTrigger className="cursor-pointer font-semibold underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
        {title} ({count})
      </CollapsibleTrigger>
      <CollapsibleContent>{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ComparisonItem({ children }: { readonly children: ReactNode }) {
  return <div className="mt-3 border-t pt-3">{children}</div>;
}

function BeforeAfter({ before, after }: { readonly before: ReactNode; readonly after: ReactNode }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4">
      <div className="min-w-0">
        <h5 className="mb-2 text-sm font-semibold">Your copy</h5>
        {before}
      </div>
      <div className="min-w-0">
        <h5 className="mb-2 text-sm font-semibold">Shared version</h5>
        {after}
      </div>
    </div>
  );
}

export function KnowledgeAreaDiffView({
  comparison,
  baseline,
  candidate,
}: {
  readonly comparison: KnowledgeAreaDiff;
  readonly baseline?: KnowledgeArea | undefined;
  readonly candidate?: KnowledgeArea | undefined;
}) {
  const baselineNames = objectiveNames(
    baseline?.objectives ?? [
      ...comparison.objectives.removed,
      ...comparison.objectives.changed.map(({ before }) => before),
    ],
  );
  const candidateNames = objectiveNames(
    candidate?.objectives ?? [
      ...comparison.objectives.added,
      ...comparison.objectives.changed.map(({ after }) => after),
    ],
  );
  const total =
    comparison.metadata.length +
    comparison.cards.added.length +
    comparison.cards.changed.length +
    comparison.cards.removed.length +
    comparison.objectives.added.length +
    comparison.objectives.changed.length +
    comparison.objectives.removed.length;

  return (
    <section className="mt-4 border-t pt-4" aria-label="Upstream version comparison">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        COMPARE WITH YOUR COPY
      </p>
      <p>
        Cards: {comparison.cards.added.length} added · {comparison.cards.changed.length} changed ·{" "}
        {comparison.cards.removed.length} removed
      </p>
      <p>
        Objectives: {comparison.objectives.added.length} added ·{" "}
        {comparison.objectives.changed.length} changed · {comparison.objectives.removed.length}{" "}
        removed
      </p>
      <p className="text-muted-foreground">
        Review only. Differences include edits made to your copy. Your content and review history
        stay unchanged; adding a personal copy creates a separate area.
      </p>
      {total === 0 && <p>This shared version matches the content in your copy.</p>}
      <ChangeSection title="Changed area details" count={comparison.metadata.length}>
        {comparison.metadata.map((change) => (
          <ComparisonItem key={change.field}>
            <h4 className="mb-2 text-base font-semibold">{metadataLabels[change.field]}</h4>
            <BeforeAfter
              before={<ContentText>{metadataText(change.before)}</ContentText>}
              after={<ContentText>{metadataText(change.after)}</ContentText>}
            />
          </ComparisonItem>
        ))}
      </ChangeSection>
      <ChangeSection title="Added cards" count={comparison.cards.added.length}>
        {comparison.cards.added.map((card) => (
          <ComparisonItem key={card.id}>
            <CardContent card={card} names={candidateNames} />
          </ComparisonItem>
        ))}
      </ChangeSection>
      <ChangeSection title="Changed cards" count={comparison.cards.changed.length}>
        {comparison.cards.changed.map(({ before, after }) => (
          <ComparisonItem key={after.id}>
            <BeforeAfter
              before={<CardContent card={before} names={baselineNames} />}
              after={<CardContent card={after} names={candidateNames} />}
            />
          </ComparisonItem>
        ))}
      </ChangeSection>
      <ChangeSection title="Removed cards" count={comparison.cards.removed.length}>
        {comparison.cards.removed.map((card) => (
          <ComparisonItem key={card.id}>
            <CardContent card={card} names={baselineNames} />
          </ComparisonItem>
        ))}
      </ChangeSection>
      <ChangeSection title="Added objectives" count={comparison.objectives.added.length}>
        {comparison.objectives.added.map((objective) => (
          <ComparisonItem key={objective.id}>
            <ObjectiveContent objective={objective} names={candidateNames} />
          </ComparisonItem>
        ))}
      </ChangeSection>
      <ChangeSection title="Changed objectives" count={comparison.objectives.changed.length}>
        {comparison.objectives.changed.map(({ before, after }) => (
          <ComparisonItem key={after.id}>
            <BeforeAfter
              before={<ObjectiveContent objective={before} names={baselineNames} />}
              after={<ObjectiveContent objective={after} names={candidateNames} />}
            />
          </ComparisonItem>
        ))}
      </ChangeSection>
      <ChangeSection title="Removed objectives" count={comparison.objectives.removed.length}>
        {comparison.objectives.removed.map((objective) => (
          <ComparisonItem key={objective.id}>
            <ObjectiveContent objective={objective} names={baselineNames} />
          </ComparisonItem>
        ))}
      </ChangeSection>
    </section>
  );
}
