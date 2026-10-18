import type { ObjectiveDiagnostic } from "@recall/application";

export function ObjectiveDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: readonly ObjectiveDiagnostic[];
}) {
  if (diagnostics.length === 0) return null;

  return (
    <section aria-label="Objective diagnostics" className="grid gap-3 rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">Objective evidence</h3>
        <p className="text-sm text-muted-foreground">
          Evidence guides practice; it does not establish mastery or change review schedules.
        </p>
      </div>
      {diagnostics.map((diagnostic) => (
        <article key={diagnostic.objectiveId} className="grid gap-1">
          <h4 className="text-sm font-medium">{diagnostic.title}</h4>
          <p className="text-sm text-muted-foreground">
            {diagnostic.status === "no-evidence"
              ? "No accepted activity evidence yet."
              : diagnostic.status === "needs-attention"
                ? "Needs attention based on the available evidence."
                : "Independent evidence is available."}{" "}
            {diagnostic.independentEvidenceCount} independent · {diagnostic.assistedEvidenceCount}{" "}
            assisted · {diagnostic.selfReportedEvidenceCount} self-reported.
          </p>
          {diagnostic.lowConfidenceOrScoreDimensions.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Review: {diagnostic.lowConfidenceOrScoreDimensions.join(", ")}.
            </p>
          )}
          {diagnostic.recommendation === "targeted-practice" && (
            <p className="text-sm font-medium">
              Recommended next: targeted practice for this objective.
            </p>
          )}
        </article>
      ))}
    </section>
  );
}
