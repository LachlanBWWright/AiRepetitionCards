import { Text, View } from "react-native";
import type { KnowledgeNotebook, StudyMaterial } from "@recall/application";
import { NativeButton } from "../../ui/NativeButton";

type CoveragePlan = NonNullable<KnowledgeNotebook["coveragePlans"]>[number];
type ClaimCoverage = {
  readonly claimId: string;
  readonly approvedCards: number;
  readonly pendingCards: number;
};

function ClaimCoverageCard({
  plan,
  claim,
  progress,
  expanded,
  focused,
  disabled,
  onToggleClaim,
  onChangeClaim,
  onFocusClaim,
}: {
  readonly plan: CoveragePlan;
  readonly claim: CoveragePlan["claims"][number];
  readonly progress: ClaimCoverage | undefined;
  readonly expanded: boolean;
  readonly focused: boolean;
  readonly disabled: boolean;
  readonly onToggleClaim: (claimId: string) => void;
  readonly onChangeClaim: (
    planId: string,
    claimId: string,
    decision: "pending" | "selected" | "skipped",
    priority: "high" | "medium" | "low",
  ) => void;
  readonly onFocusClaim: (claimId: string) => void;
}) {
  return (
    <View className="gap-[5px] border-b border-b-recall-line pb-[8px]">
      <NativeButton
        label={claim.title}
        onPress={() => {
          onToggleClaim(claim.id);
        }}
        disabled={disabled}
        className="py-[10px] px-[4px]"
        labelClassName="text-recall-surface text-[12px] font-bold"
      />
      {expanded ? (
        <Text className="text-recall-ink text-[12px] leading-[18px]">{claim.description}</Text>
      ) : null}
      <Text className="text-recall-muted text-[11px] leading-[16px]">
        {progress?.approvedCards ?? 0} cards · {progress?.pendingCards ?? 0} suggestions
      </Text>
      {expanded && <ClaimSources claim={claim} />}
      <View className="flex-row flex-wrap gap-[7px]">
        <DecisionButton
          label={claim.decision === "selected" ? "✓ Selected" : "Select"}
          disabled={disabled}
          onPress={() => {
            onChangeClaim(plan.id, claim.id, "selected", claim.priority);
          }}
        />
        <DecisionButton
          label={claim.decision === "skipped" ? "✓ Skipped" : "Skip"}
          disabled={disabled}
          onPress={() => {
            onChangeClaim(plan.id, claim.id, "skipped", claim.priority);
          }}
        />
        {expanded && (
          <ClaimPriorityButtons
            claim={claim}
            disabled={disabled}
            onChange={(priority) => {
              onChangeClaim(plan.id, claim.id, claim.decision, priority);
            }}
          />
        )}
        <DecisionButton
          label={`${focused ? "✓ " : ""}Focus on this topic`}
          disabled={disabled || claim.decision !== "selected"}
          onPress={() => {
            onFocusClaim(claim.id);
          }}
        />
      </View>
    </View>
  );
}

function DecisionButton({
  label,
  disabled,
  onPress,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onPress: () => void;
}) {
  return (
    <NativeButton
      label={label}
      onPress={onPress}
      disabled={disabled}
      className="py-[10px] px-[4px]"
      labelClassName="text-recall-surface text-[12px] font-bold"
    />
  );
}

function ClaimPriorityButtons({
  claim,
  disabled,
  onChange,
}: {
  readonly claim: CoveragePlan["claims"][number];
  readonly disabled: boolean;
  readonly onChange: (priority: "high" | "medium" | "low") => void;
}) {
  return (
    <>
      {(["high", "medium", "low"] as const).map((priority) => (
        <DecisionButton
          key={priority}
          label={`${claim.priority === priority ? "✓ " : ""}${priority}`}
          disabled={disabled}
          onPress={() => {
            onChange(priority);
          }}
        />
      ))}
    </>
  );
}

function ClaimSources({ claim }: { readonly claim: CoveragePlan["claims"][number] }) {
  return (
    <>
      {claim.sourceReferences.map((reference, index) => (
        <Text key={index} selectable className="text-recall-muted text-[11px] leading-[16px]">
          {reference.pageNumber ? `Page ${String(reference.pageNumber)}: ` : ""}
          {reference.quote}
        </Text>
      ))}
    </>
  );
}

export function NativeStudyMaterialsPanelClaims({
  plans,
  sections,
  coverage,
  expandedClaimId,
  targetClaimId,
  disabled,
  onToggleClaim,
  onChangeClaim,
  onFocusClaim,
}: {
  readonly plans: readonly CoveragePlan[];
  readonly sections: StudyMaterial["sections"];
  readonly coverage: readonly ClaimCoverage[];
  readonly expandedClaimId: string | null;
  readonly targetClaimId: string | null;
  readonly disabled: boolean;
  readonly onToggleClaim: (claimId: string) => void;
  readonly onChangeClaim: (
    planId: string,
    claimId: string,
    decision: "pending" | "selected" | "skipped",
    priority: "high" | "medium" | "low",
  ) => void;
  readonly onFocusClaim: (claimId: string) => void;
}) {
  return (
    <View className="gap-[5px]">
      {plans.map((plan) => (
        <View key={plan.id} className="gap-[5px] border-b border-b-recall-line pb-[8px]">
          <Text className="text-recall-muted text-[11px] leading-[16px]">
            Source: {sections.find((item) => item.id === plan.sectionId)?.title}
          </Text>
          {plan.claims.map((claim) => {
            const progress = coverage.find((item) => item.claimId === claim.id);
            return (
              <ClaimCoverageCard
                key={claim.id}
                plan={plan}
                claim={claim}
                progress={progress}
                expanded={expandedClaimId === claim.id}
                focused={targetClaimId === claim.id}
                disabled={disabled}
                onToggleClaim={onToggleClaim}
                onChangeClaim={onChangeClaim}
                onFocusClaim={onFocusClaim}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}
