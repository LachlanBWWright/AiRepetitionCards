"use client";
import { useEffect, useState } from "react";
import { Effect, Either } from "effect";
import { Button } from "@/components/ui/Button";
import { Alert, Input, toast } from "@recall/ui-web";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@recall/ui-web/components/collapsible";
import {
  parseLocalBudgetLimit,
  type LocalBudgetApi,
  type LocalAiUsageSnapshot,
} from "@recall/application";

export function BudgetSettingsPanel({
  api,
  accountId,
  initialSnapshot,
}: {
  readonly api: LocalBudgetApi;
  readonly accountId: string;
  readonly initialSnapshot?: LocalAiUsageSnapshot;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot ?? null);
  const [fields, setFields] = useState<readonly string[]>(
    initialSnapshot
      ? [
          initialSnapshot.policy.dailyRequestLimit,
          initialSnapshot.policy.weeklyRequestLimit,
          initialSnapshot.policy.dailyResearchLimit,
        ].map((limit) => (limit === null ? "" : String(limit)))
      : ["", "", ""],
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const publish = (value: LocalAiUsageSnapshot) => {
    setSnapshot(value);
    setFields(
      [
        value.policy.dailyRequestLimit,
        value.policy.weeklyRequestLimit,
        value.policy.dailyResearchLimit,
      ].map((limit) => (limit === null ? "" : String(limit))),
    );
  };
  useEffect(() => {
    let active = true;
    if (initialSnapshot) return;
    void Effect.runPromise(Effect.either(api.read(accountId))).then((result) => {
      if (!active) return;
      if (Either.isRight(result)) publish(result.right);
      else setMessage(result.left.message);
    });
    return () => {
      active = false;
    };
  }, [api, accountId, initialSnapshot]);
  async function refresh() {
    setBusy(true);
    const result = await Effect.runPromise(Effect.either(api.read(accountId)));
    setBusy(false);
    if (Either.isRight(result)) setSnapshot(result.right);
    else setMessage(result.left.message);
  }
  async function save() {
    const limits = fields.map(parseLocalBudgetLimit);
    if (limits.some((limit) => limit === "invalid")) {
      setMessage("Use whole numbers from 0 to 1,000,000; leave blank for unlimited.");
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await Effect.runPromise(
      Effect.either(
        api.setBudget({
          accountId,
          dailyRequestLimit: limits[0],
          weeklyRequestLimit: limits[1],
          dailyResearchLimit: limits[2],
        }),
      ),
    );
    setBusy(false);
    if (Either.isRight(result)) {
      publish(result.right);
      toast.success("AI usage limits saved.");
    } else setMessage(result.left.message);
  }
  return (
    <section className="space-y-4 py-4" aria-label="AI budget settings">
      <h2 className="mb-2 text-lg font-semibold">AI usage limits</h2>
      <p>Request limits for this account on this device. Leave blank for unlimited.</p>
      <Button variant="secondary" type="button" disabled={busy} onClick={() => void refresh()}>
        Refresh usage
      </Button>
      {snapshot && (
        <>
          <p>
            {snapshot.summary.daily.requests} requests today · {snapshot.summary.weekly.requests}{" "}
            this week
          </p>
          <Collapsible>
            <CollapsibleTrigger className="font-medium underline underline-offset-4 hover:text-primary">
              Usage details and reset times
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p>
                Today: {snapshot.summary.daily.completed} completed ·{" "}
                {snapshot.summary.daily.failed} failed · {snapshot.summary.daily.pending} pending.
              </p>
              <p>{snapshot.summary.daily.researchRequests} research requests.</p>
              <p>
                Known tokens: {snapshot.summary.daily.inputTokens} input ·{" "}
                {snapshot.summary.daily.outputTokens} output. Usage unavailable for{" "}
                {snapshot.summary.daily.unknownUsageRequests} requests.
              </p>
              <p>
                Days reset at midnight UTC; weeks on Monday. Failed and pending requests count. A
                limit of 0 blocks new requests.
              </p>
              <p>These limits do not show remaining ChatGPT allowance or set a spending cap.</p>
            </CollapsibleContent>
          </Collapsible>
          {(["Daily requests", "Weekly requests", "Daily research requests"] as const).map(
            (label, index) => (
              <label key={label} className="mb-3 block">
                {label}
                <Input
                  aria-label={label}
                  type="text"
                  inputMode="numeric"
                  value={fields[index] ?? ""}
                  disabled={busy}
                  onChange={(event) =>
                    setFields(
                      fields.map((value, position) =>
                        position === index ? event.target.value : value,
                      ),
                    )
                  }
                  placeholder="Unlimited"
                />
              </label>
            ),
          )}
          <Button type="button" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save limits"}
          </Button>
        </>
      )}
      {message && <Alert variant="destructive">{message}</Alert>}
    </section>
  );
}
