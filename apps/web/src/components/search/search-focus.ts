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
  revealAndFocusTarget(node, root);
  return true;
}

/** Reveal mounted task panels and disclosures before restoring focus to their content. */
export function revealAndFocusTarget(node: HTMLElement, root?: HTMLElement): void {
  let parent: HTMLElement | null = node;
  while (parent && (!root || root.contains(parent))) {
    if (parent instanceof HTMLDetailsElement) parent.open = true;
    if (parent.dataset.slot === "tabs-content") {
      const triggerId = parent.getAttribute("aria-labelledby");
      if (triggerId)
        document
          .getElementById(triggerId)
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    if (parent.dataset.slot === "collapsible" && parent.dataset.state === "closed") {
      parent.querySelector<HTMLElement>("[data-slot=collapsible-trigger]")?.click();
    }
    parent = parent.parentElement;
  }
  requestAnimationFrame(() => {
    node.scrollIntoView({ block: "center" });
    node.focus({ preventScroll: true });
  });
}
