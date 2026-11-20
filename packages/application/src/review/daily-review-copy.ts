/** Portable presentation copy for the same review entry point on every client. */
export function dailyReviewCopy(due: number): {
  readonly title: string;
  readonly description: string;
} {
  return due > 0
    ? {
        title: `${String(due)} ${due === 1 ? "card" : "cards"} ready to review`,
        description: "Pick up where you left off, across all your subjects.",
      }
    : {
        title: "You’re up to date",
        description: "Your next review will appear here when it’s due.",
      };
}
