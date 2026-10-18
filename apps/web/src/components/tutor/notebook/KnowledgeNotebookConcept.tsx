import type { KnowledgeNotebookModel } from "./useKnowledgeNotebookModel";

type Notebook = NonNullable<KnowledgeNotebookModel["notebook"]>;
type Concept = Notebook["concepts"][number];

export function KnowledgeNotebookConceptList({
  concepts,
  notebook,
  assessments,
  libraryCards,
}: {
  readonly concepts: Notebook["concepts"];
  readonly notebook: Notebook;
  readonly assessments: KnowledgeNotebookModel["assessments"];
  readonly libraryCards: KnowledgeNotebookModel["knowledgeArea"]["cards"];
}) {
  return concepts.map((concept) => (
    <KnowledgeNotebookConcept
      key={concept.id}
      concept={concept}
      notebook={notebook}
      assessments={assessments}
      libraryCards={libraryCards}
    />
  ));
}

function LibraryCoverage({
  cards,
}: {
  readonly cards: readonly KnowledgeNotebookModel["knowledgeArea"]["cards"][number][];
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold leading-6">Library coverage · {cards.length} cards</h3>
      <div className="space-y-4 pt-3">
        {cards.map((card) => (
          <div key={card.id} className="whitespace-pre-wrap py-2">
            {card.kind === "basic" ? (
              <>
                <strong>{card.front}</strong>
                <p>{card.back}</p>
              </>
            ) : (
              <p>{card.text}</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export function KnowledgeNotebookConcept({
  concept,
  notebook,
  assessments,
  libraryCards,
}: {
  readonly concept: Concept;
  readonly notebook: Notebook;
  readonly assessments: KnowledgeNotebookModel["assessments"];
  readonly libraryCards: KnowledgeNotebookModel["knowledgeArea"]["cards"];
}) {
  const assessment = assessments.find((entry) => entry.conceptId === concept.id);
  const parent = notebook.concepts.find((entry) => entry.id === concept.parentId);
  const linkedIds = new Set(
    notebook.evidence
      .filter((entry) => entry.conceptId === concept.id)
      .flatMap((entry) => entry.linkedCardIds),
  );
  const sourceCards = libraryCards.filter(
    (card) =>
      linkedIds.has(card.id) ||
      (concept.objectiveId != null && card.objectiveIds.includes(concept.objectiveId)) ||
      (String(concept.id) === String(notebook.areaId) &&
        concept.parentId === null &&
        card.objectiveIds.length === 0),
  );
  const prerequisites = concept.prerequisiteIds
    .map((id) => notebook.concepts.find((entry) => entry.id === id)?.title ?? "Unknown concept")
    .join(", ");

  return (
    <li
      tabIndex={-1}
      data-search-target={`concept:${concept.id}`}
      className="border-b py-3 [&_p]:my-1.5"
    >
      <section className="space-y-3">
        <h3 className="text-sm font-semibold leading-6">
          {concept.title} · {assessment?.status.replaceAll("-", " ") ?? "unassessed"}
        </h3>
        <div className="space-y-4 pt-3">
          {parent && <p>Within {parent.title}</p>}
          {prerequisites && <p>Builds on: {prerequisites}</p>}
          <p>
            {assessment?.status.replaceAll("-", " ") ?? "unassessed"} ·{" "}
            {assessment?.evidenceCount ?? 0} observations
          </p>
          <small>{assessment?.reason}</small>
          <LibraryCoverage cards={sourceCards} />
          {concept.id === notebook.session.targetConceptId && (
            <p>Current focus · {notebook.session.mode}</p>
          )}
        </div>
      </section>
    </li>
  );
}
