import type { AreaId, AssessmentId, ObjectiveId, Workspace } from "@recall/domain";
import type { KnowledgeNotebook } from "./knowledge-notebook";

export type WorkspaceSearchTarget =
  | { readonly kind: "area" }
  | { readonly kind: "card"; readonly cardId: AssessmentId }
  | { readonly kind: "objective"; readonly objectiveId: ObjectiveId }
  | { readonly kind: "concept"; readonly conceptId: ObjectiveId; readonly namespace: string }
  | { readonly kind: "material"; readonly materialId: string; readonly namespace: string }
  | {
      readonly kind: "passage";
      readonly materialId: string;
      readonly sectionId: string;
      readonly namespace: string;
    }
  | {
      readonly kind: "claim";
      readonly claimId: string;
      readonly materialId: string;
      readonly sectionId: string;
      readonly namespace: string;
    }
  | {
      readonly kind: "conversation";
      readonly evidenceId: string;
      readonly conceptId: ObjectiveId;
      readonly namespace: string;
    }
  | {
      readonly kind: "suggestion";
      readonly proposalId: string;
      readonly conceptId: ObjectiveId;
      readonly namespace: string;
    };
export type WorkspaceSearchKind = WorkspaceSearchTarget["kind"];
export type WorkspaceSearchNotebook = {
  readonly notebook: KnowledgeNotebook;
  readonly namespace: string;
};
export type WorkspaceSearchNotebookLoadResult = {
  readonly notebooks: readonly WorkspaceSearchNotebook[];
  readonly unreadableCount: number;
};
export type WorkspaceSearchResult = {
  readonly id: string;
  readonly kind: WorkspaceSearchKind;
  readonly title: string;
  readonly snippet: string;
  readonly areaId: AreaId;
  readonly areaTitle: string;
  readonly target: WorkspaceSearchTarget;
  readonly score: number;
};
export type WorkspaceSearchOptions = {
  readonly limit?: number;
  readonly kinds?: readonly WorkspaceSearchKind[];
};
const normalize = (text: string): string =>
  text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
function excerpt(text: string, terms: readonly string[]): string {
  const clean = text.replace(/\s+/gu, " ").trim();
  const folded = normalize(clean);
  const positions = terms.map((term) => folded.indexOf(term)).filter((position) => position >= 0);
  // Normalization may expand ligatures or compose combining marks. Map the match
  // offset back to the original text before slicing a human-readable excerpt.
  const foldedPosition = positions.length ? Math.min(...positions) : 0;
  let low = 0;
  let high = clean.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (clean.slice(0, middle).normalize("NFKC").toLowerCase().length < foldedPosition)
      low = middle + 1;
    else high = middle;
  }
  const start = Math.max(0, low - 65);
  return `${start > 0 ? "…" : ""}${clean.slice(start, start + 210)}${start + 210 < clean.length ? "…" : ""}`;
}

/** Local deterministic full-text search. Only current areas and their validated notebooks are indexed. */
export function searchWorkspace(
  workspace: Workspace,
  notebooks: readonly WorkspaceSearchNotebook[],
  query: string,
  options: WorkspaceSearchOptions = {},
): readonly WorkspaceSearchResult[] {
  const phrase = normalize(query).slice(0, 500);
  const terms = [...new Set(phrase.split(/\s+/u).filter(Boolean))];
  if (!terms.length) return [];
  const results: WorkspaceSearchResult[] = [];
  const areas = new Map(workspace.areas.map((area) => [area.id, area]));
  const add = (
    areaId: AreaId,
    target: WorkspaceSearchTarget,
    identity: string,
    title: string,
    body: string,
  ): void => {
    const area = areas.get(areaId);
    if (!area || (options.kinds && !options.kinds.includes(target.kind))) return;
    const heading = normalize(title);
    const content = normalize(body);
    const text = `${heading} ${content}`;
    if (!terms.every((term) => text.includes(term))) return;
    const score =
      (heading === phrase ? 100 : heading.includes(phrase) ? 60 : 0) +
      (content.includes(phrase) ? 15 : 0) +
      terms.reduce((sum, term) => sum + (heading.includes(term) ? 12 : 2), 0);
    results.push({
      id: JSON.stringify([areaId, target.kind, identity]),
      kind: target.kind,
      title,
      snippet: excerpt(body || title, terms),
      areaId,
      areaTitle: area.title,
      target,
      score,
    });
  };
  for (const area of workspace.areas) {
    add(
      area.id,
      { kind: "area" },
      area.id,
      area.title,
      [area.description, ...(area.tags ?? [])].filter(Boolean).join(" "),
    );
    for (const card of area.cards)
      add(
        area.id,
        { kind: "card", cardId: card.id },
        card.id,
        card.front,
        [card.back, card.objective, card.cloze?.text, ...(card.tags ?? [])]
          .filter(Boolean)
          .join(" "),
      );
    for (const objective of area.objectives ?? [])
      add(
        area.id,
        { kind: "objective", objectiveId: objective.id },
        objective.id,
        objective.title,
        objective.description ?? "",
      );
  }
  const seen = new Set<string>();
  for (const { notebook, namespace } of notebooks) {
    if (!areas.has(notebook.areaId)) continue;
    const key = JSON.stringify([namespace, notebook.areaId]);
    if (seen.has(key)) continue;
    seen.add(key);
    const identify = (id: string) => JSON.stringify([namespace, id]);
    for (const concept of notebook.concepts)
      add(
        notebook.areaId,
        { kind: "concept", conceptId: concept.id, namespace },
        identify(concept.id),
        concept.title,
        concept.description ?? "",
      );
    for (const material of notebook.materials ?? []) {
      add(
        notebook.areaId,
        { kind: "material", materialId: material.id, namespace },
        identify(material.id),
        material.name,
        material.sections.map((section) => section.title).join(" "),
      );
      for (const section of material.sections)
        add(
          notebook.areaId,
          { kind: "passage", materialId: material.id, sectionId: section.id, namespace },
          identify(section.id),
          `${material.name} · ${section.title}`,
          section.text,
        );
    }
    for (const plan of notebook.coveragePlans ?? [])
      for (const claim of plan.claims)
        add(
          notebook.areaId,
          {
            kind: "claim",
            claimId: claim.id,
            materialId: plan.materialId,
            sectionId: plan.sectionId,
            namespace,
          },
          identify(claim.id),
          claim.title,
          `${claim.description} ${claim.sourceReferences.map((reference) => reference.quote).join(" ")}`,
        );
    for (const evidence of notebook.evidence)
      if (evidence.kind === "tutor")
        add(
          notebook.areaId,
          {
            kind: "conversation",
            evidenceId: evidence.id,
            conceptId: evidence.conceptId,
            namespace,
          },
          identify(evidence.id),
          evidence.question,
          `${evidence.answer} ${evidence.evaluation.feedback} ${evidence.evaluation.misconception ?? ""}`,
        );
    for (const proposal of notebook.proposals)
      if (proposal.status === "pending")
        add(
          notebook.areaId,
          { kind: "suggestion", proposalId: proposal.id, conceptId: proposal.conceptId, namespace },
          identify(proposal.id),
          proposal.proposal.front,
          `${proposal.proposal.back} ${proposal.proposal.rationale}`,
        );
  }
  const limit = Math.max(
    1,
    Math.min(200, Number.isFinite(options.limit) ? Math.floor(options.limit ?? 50) : 50),
  );
  return results
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.title.localeCompare(right.title) ||
        left.id.localeCompare(right.id),
    )
    .slice(0, limit);
}
