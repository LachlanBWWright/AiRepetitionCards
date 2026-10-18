import { deriveStudyClaimCoverage, type KnowledgeNotebook } from "@recall/application";
import { Effect } from "effect";

type DerivedClaimCoverage = Effect.Effect.Success<
  ReturnType<typeof deriveStudyClaimCoverage>
>[number];

export function chooseNextCoverageClaim(
  claims: readonly DerivedClaimCoverage[],
  notebook: KnowledgeNotebook,
): DerivedClaimCoverage | undefined {
  const selectedClaims = claims.filter((claim) => {
    if (claim.decision !== "selected" || claim.status !== "uncovered") return false;
    return (notebook.materials ?? []).some(
      (material) =>
        material.id === claim.materialId &&
        material.sections.some((section) => section.id === claim.sectionId && section.selected),
    );
  });
  const rank = { high: 0, medium: 1, low: 2 } as const;
  return selectedClaims.sort((left, right) => rank[left.priority] - rank[right.priority])[0];
}
