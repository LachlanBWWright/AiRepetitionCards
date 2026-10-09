import type { WorkspaceSearchTarget } from "@recall/application";

export function searchTargetKey(target: WorkspaceSearchTarget): string | null {
  switch (target.kind) {
    case "concept":
      return `concept:${target.conceptId}`;
    case "material":
      return `material:${target.materialId}`;
    case "passage":
      return `passage:${target.sectionId}`;
    case "claim":
      return `claim:${target.claimId}`;
    case "conversation":
      return `conversation:${target.evidenceId}`;
    case "suggestion":
      return `suggestion:${target.proposalId}`;
    default:
      return null;
  }
}

export function focusSearchTarget(root: HTMLElement, target: WorkspaceSearchTarget): boolean {
  const key = searchTargetKey(target);
  const node = [...root.querySelectorAll<HTMLElement>("[data-search-target]")].find(
    (element) => element.dataset.searchTarget === key,
  );
  if (!node) return false;
  let parent: HTMLElement | null = node;
  while (parent && root.contains(parent)) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    parent = parent.parentElement;
  }
  node.scrollIntoView({ block: "center" });
  node.focus({ preventScroll: true });
  return true;
}
