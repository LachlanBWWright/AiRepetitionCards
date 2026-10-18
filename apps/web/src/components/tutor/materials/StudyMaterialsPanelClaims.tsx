import { Label } from "@recall/ui-web/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@recall/ui-web/components/select";
import type { StudyCoverageClaim, StudyCoveragePlan } from "@recall/application";

type ClaimProgress = {
  readonly claimId: string;
  readonly status: string;
  readonly pendingCards: number;
  readonly approvedCards: number;
};

type StudyMaterialsPanelClaimsProps = {
  readonly plans: readonly StudyCoveragePlan[];
  readonly claimCoverage: readonly ClaimProgress[];
  readonly disabled: boolean;
  readonly onClaimChange: (
    planId: string,
    claim: StudyCoverageClaim,
    decision: StudyCoverageClaim["decision"],
    priority: StudyCoverageClaim["priority"],
  ) => void;
};

function StudyMaterialsClaim({
  planId,
  claim,
  progress,
  disabled,
  onClaimChange,
}: {
  readonly planId: string;
  readonly claim: StudyCoverageClaim;
  readonly progress: ClaimProgress | undefined;
  readonly disabled: boolean;
  readonly onClaimChange: StudyMaterialsPanelClaimsProps["onClaimChange"];
}) {
  return (
    <article
      tabIndex={-1}
      data-search-target={`claim:${claim.id}`}
      className="space-y-4 border-b py-5"
    >
      <strong>{claim.title}</strong>
      <p>{claim.description}</p>
      <p>
        {progress?.status ?? "pending"} · {progress?.pendingCards ?? 0} pending ·{" "}
        {progress?.approvedCards ?? 0} approved
      </p>
      <section className="space-y-3">
        <h3 className="text-sm font-semibold leading-6">Source passages</h3>
        <div className="space-y-4 pt-3">
          {claim.sourceReferences.map((reference, index) => (
            <blockquote key={index}>{reference.quote}</blockquote>
          ))}
        </div>
      </section>
      <Label>
        Include topic
        <Select
          disabled={disabled}
          value={claim.decision}
          onValueChange={(decision) => {
            if (decision === "pending" || decision === "selected" || decision === "skipped")
              onClaimChange(planId, claim, decision, claim.priority);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Include topic">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Review later</SelectItem>
            <SelectItem value="selected">Include</SelectItem>
            <SelectItem value="skipped">Skip</SelectItem>
          </SelectContent>
        </Select>
      </Label>
      <Label>
        Priority
        <Select
          disabled={disabled}
          value={claim.priority}
          onValueChange={(priority) => {
            if (priority === "high" || priority === "medium" || priority === "low")
              onClaimChange(planId, claim, claim.decision, priority);
          }}
        >
          <SelectTrigger className="w-full" aria-label="Priority">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
      </Label>
    </article>
  );
}

export function StudyMaterialsPanelClaims({
  plans,
  claimCoverage,
  disabled,
  onClaimChange,
}: StudyMaterialsPanelClaimsProps) {
  return plans.map((plan) => (
    <div key={plan.id}>
      <h4 className="text-sm font-semibold">Choose topics</h4>
      {plan.claims.map((claim) => (
        <StudyMaterialsClaim
          key={claim.id}
          planId={plan.id}
          claim={claim}
          progress={claimCoverage.find((item) => item.claimId === claim.id)}
          disabled={disabled}
          onClaimChange={onClaimChange}
        />
      ))}
    </div>
  ));
}
