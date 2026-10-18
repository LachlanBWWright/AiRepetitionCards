import type { DeckQualityIssue } from "@recall/application";
import { Badge } from "@recall/ui-web/components/badge";

export function DeckQualityPanel({ issues }: { readonly issues: readonly DeckQualityIssue[] }) {
  const blockers = issues.filter((issue) => issue.severity === "blocking").length;
  return (
    <section aria-labelledby="deck-quality-title" className="rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="deck-quality-title" className="font-semibold">
          Deck quality
        </h3>
        <Badge variant={blockers > 0 ? "destructive" : "secondary"}>
          {blockers > 0
            ? `${String(blockers)} publishing blocker${blockers === 1 ? "" : "s"}`
            : `${String(issues.length)} suggestion${issues.length === 1 ? "" : "s"}`}
        </Badge>
      </div>
      {issues.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          No quality issues found. This check does not assess learning mastery.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {issues.map((issue, index) => (
            <li
              key={`${issue.code}-${String(issue.cardId ?? issue.activityId ?? index)}`}
              className="text-sm"
            >
              <span className="font-medium">
                {issue.severity === "blocking" ? "Fix before publishing: " : "Review: "}
              </span>
              {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
