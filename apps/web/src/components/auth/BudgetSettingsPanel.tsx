"use client";
import { useEffect, useState } from "react";
import { Effect, Either } from "effect";
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
      setMessage("Limits saved. Recorded usage is unchanged.");
    } else setMessage(result.left.message);
  }
  return (
    <section className="tutor-panel" aria-label="AI budget settings">
      <p className="eyebrow">THIS DEVICE · AI USAGE</p>
      <h2>AI budget settings</h2>
      <p>
        Limits apply to this account on this installation. They do not show your remaining ChatGPT
        allowance or enforce a monetary spending cap.
      </p>
      <p>
        Days reset at midnight UTC. Weeks reset Monday at midnight UTC. Failed and pending requests
        count. Blank means unlimited; 0 blocks new requests.
      </p>
      <button type="button" className="text-button" disabled={busy} onClick={() => void refresh()}>
        Refresh usage
      </button>
      {snapshot && (
        <>
          <dl>
            <dt>Today / this week</dt>
            <dd>
              {snapshot.summary.daily.requests} / {snapshot.summary.weekly.requests} requests
            </dd>
            <dt>Today’s completed / failed / pending</dt>
            <dd>
              {snapshot.summary.daily.completed} / {snapshot.summary.daily.failed} /{" "}
              {snapshot.summary.daily.pending}
            </dd>
            <dt>Research today</dt>
            <dd>{snapshot.summary.daily.researchRequests} requests</dd>
            <dt>Known tokens today</dt>
            <dd>
              {snapshot.summary.daily.inputTokens} input · {snapshot.summary.daily.outputTokens}{" "}
              output · {snapshot.summary.daily.unknownUsageRequests} requests with unknown usage
            </dd>
          </dl>
          {(["Daily requests", "Weekly requests", "Daily research requests"] as const).map(
            (label, index) => (
              <label key={label} style={{ display: "block", marginBottom: 12 }}>
                {label}
                <input
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
          <button
            type="button"
            className="primary-button"
            disabled={busy}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save limits"}
          </button>
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
