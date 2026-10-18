import type { ObjectiveDiagnostic } from "@recall/application";
import { Text, View } from "react-native";

export function NativeObjectiveDiagnostics({
  diagnostics,
}: {
  readonly diagnostics: readonly ObjectiveDiagnostic[];
}) {
  if (diagnostics.length === 0) return null;

  return (
    <View
      accessibilityLabel="Objective diagnostics"
      className="gap-3 rounded-xl border border-recall-line p-4"
    >
      <View>
        <Text accessibilityRole="header" className="font-bold">
          Objective evidence
        </Text>
        <Text className="text-sm text-recall-muted">
          Evidence guides practice; it does not establish mastery or change review schedules.
        </Text>
      </View>
      {diagnostics.map((diagnostic) => (
        <View key={diagnostic.objectiveId} className="gap-1">
          <Text className="text-sm font-bold">{diagnostic.title}</Text>
          <Text className="text-sm text-recall-muted">
            {diagnostic.status === "no-evidence"
              ? "No accepted activity evidence yet."
              : diagnostic.status === "needs-attention"
                ? "Needs attention based on the available evidence."
                : "Independent evidence is available."}{" "}
            {diagnostic.independentEvidenceCount} independent · {diagnostic.assistedEvidenceCount}{" "}
            assisted · {diagnostic.selfReportedEvidenceCount} self-reported.
          </Text>
          {diagnostic.lowConfidenceOrScoreDimensions.length > 0 && (
            <Text className="text-sm text-recall-muted">
              Review: {diagnostic.lowConfidenceOrScoreDimensions.join(", ")}.
            </Text>
          )}
          {diagnostic.recommendation === "targeted-practice" && (
            <Text className="text-sm font-bold">
              Recommended next: targeted practice for this objective.
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}
