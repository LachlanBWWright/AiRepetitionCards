import type { ReviewRepairAction } from "./review-repair";

export const reviewRepairCopy = {
  title: "Help with this card",
  description: "Understand the answer or make the card easier to learn.",
  context: "Card you’re reviewing",
  answer: "View current answer",
  options: "What would help?",
  working: "Working on this card…",
  response: "Tutor response",
  original: "Original",
  proposed: "Proposed cards",
  approve: "Approve and save cards",
  discard: "Discard suggestions",
  duplicates: "These suggestions overlap existing cards. Keep duplicates anyway.",
  paused: "Reviews are paused. Suggested changes are saved only after you approve them.",
} as const;
export function reviewRepairApprovalNote(action: ReviewRepairAction): string {
  return action === "split"
    ? "Approval moves the original to recoverable deleted cards and creates replacements with fresh schedules. Existing review history is preserved."
    : "Approval adds prerequisite cards. The original card and its schedule stay unchanged.";
}
