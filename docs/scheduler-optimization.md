# Scheduler optimization and due-date recalculation

Parameter fitting runs locally over every available effective review event, with no card or review-count sample cap. Complete histories are replayed in deterministic causal order, so the selected cards do not depend on identifiers or input order. Scoring yields between 512-event chunks; abandoning the editor aborts fitting. Runtime grows with history size because every candidate replays the histories.

An optional per-policy **Exclude answers before (UTC)** date excludes older answers from training and holdout scores. Older events remain as warmup evidence for each card's memory state. The latest 20% of eligible event timestamps form the temporal holdout. At least 100 day-separated observations, including 20 holdout and 60 training observations, are required. Same-day learning answers establish memory but are not independent recall observations.

The deterministic coordinate search uses three step sizes (25%, 10%, 2.5%). Candidates are selected using training log loss. A proposal is usable only if holdout log loss improves by more than 0.0001 and holdout RMSE does not increase. Otherwise the starting weights are returned unchanged. This is an experimental local fitter, not Anki's optimizer; fitting all histories does not establish equivalent optimization quality. Calibration buckets, observation counts and complete history counts remain visible in the proposal.

By default, saved scheduling changes affect subsequent answers. The optional per-policy **Recalculate reviewed cards’ due dates** setting applies when effective weights, retention, maximum interval, easy weekdays or time zone change on save. The same rule applies to subjects inheriting named presets. Validation of a settings draft does not reschedule cards.

Recalculation uses the existing stability with the selected FSRS retention/decay parameters, maximum interval and easy weekday policy, anchored to the last real answer. It changes only reviewed cards' due dates; it does not retroactively refit their memory state, alter learning/new cards, fabricate answers or rewrite historical parameter IDs. Changed due dates become append-only scheduling adjustments anchored to the latest answer. Replay preserves them until the next answer consumes them. Increasing retention can make cards immediately overdue.

Regression coverage checks the FSRS reference property that a card with stability 20 has a 20-day interval at 90% retention, interval bounds, parameter-ID replay, deterministic fitting, holdout acceptance, more than 200 card histories, cutoff warmup, opt-in save behavior and unchanged answer history. A real-world cross-implementation optimizer benchmark remains necessary before calling this Anki optimizer parity.

## Independent reference scoring check

The checked-in `fsrs-reference-fixture.ts` is generated with the official [py-fsrs implementation](https://github.com/open-spaced-repetition/py-fsrs), pinned to `fsrs==6.3.0`. Its generator lives in `packages/verification/fixtures/scheduler/generate-fsrs-reference.py` and records the wheel SHA256. It replays 125 daily answers, including repeated failures, and independently calculates holdout log loss/RMSE and final stability/difficulty. TypeScript regression checks compare these values within 0.000001. Fitting uses weights quantized to three decimal places to match the application's serialized parameter IDs; ordinary default-parameter replay uses the unquantized defaults in both implementations.

Regenerating the fixture requires Python with `fsrs==6.3.0` installed, then `python3 packages/verification/fixtures/scheduler/generate-fsrs-reference.py` from the repository root. Normal verification uses the checked-in fixture and needs no Python. This checks the scoring model and replay, not equivalence to the official PyTorch optimizer or Anki's optimization results. Their optimizer dependencies are not application dependencies.

## Compare fitting against independent weights

Run a bounded local benchmark without applying any scheduling changes:

```sh
pnpm --filter @recall/verification benchmark:scheduler /absolute/path/benchmark.json
```

The input is an object with `events` (validated ReviewEvent records), `referenceName` and
`referenceWeights` (21 compatible FSRS 6 weights from a separately run reference optimizer).
An optional `reviewedAfter` UTC timestamp uses the same warmup policy as ordinary fitting.
Use identical training data and a reference run that excludes the latest 20% of timestamps;
reference weights trained on that holdout would leak test answers into the comparison.

The command reports baseline, fitted and reference holdout log loss/RMSE, observation counts,
fit runtime and the log-loss gap to the reference. It does not upload input history, apply weights,
or claim equivalence to Anki. Regressions verify identical holdout scoring with both a synthetic control and independently
trained synthetic reference weights (below). A representative real-world collection corpus remains
a release/research acceptance step.

## Reproducible independently optimized synthetic corpus

`optimizer-reference.test.ts` now compares the local fitter against weights actually trained by
**official py-fsrs 6.3.0's PyTorch optimizer**, rather than manually selected reference weights.
The checked-in fixture covers 24 complete card histories and 960 answers, with three deterministic
failure-rate/interval profiles (40%, 20%, and 5% failures at one-, two-, and three-day gaps).
Only the first 768 answers by timestamp enter reference training; the remaining 192 observations
are unseen by both optimizers during fitting. Holdout answers still update memory state before
subsequent holdout predictions, matching ordinary next-answer evaluation.

Regenerate in a separate Python 3.12 environment:

```sh
python -m pip install -r packages/verification/fixtures/scheduler/optimizer-reference-requirements.txt
python packages/verification/fixtures/scheduler/generate-optimizer-reference.py
pnpm --filter web exec prettier --write ../../packages/verification/tests/review/optimizer-reference-fixture.ts
pnpm --filter @recall/verification exec node scripts/run.mjs optimizer-reference.test.ts
```

The requirements and generated manifest pin fsrs, CPU PyTorch, pandas and tqdm. Training uses
seed 42, one CPU thread and deterministic Torch operations. Reference weights are quantized to
three decimal places to match serialized application weights. There is a model boundary worth
recording: ts-fsrs 5.4.2 floors **initial** stability at 0.1 days, while py-fsrs permits 0.001.
Independent Python holdout scoring applies that first-answer floor to match the application;
reference training remains untouched. The regression compares independent log loss and RMSE
within 0.000001.

For this corpus, baseline and accepted local holdout loss are 0.293678 (RMSE 0.247828), versus
0.334890 (RMSE 0.279031) for the independent optimizer's weights. The local candidate is rejected
by the existing holdout safeguard, leaving baseline weights intact. This illustrates why fitting
is a proposal: optimization can overfit. These synthetic, mixed-population profiles are a
reproducible interoperability and acceptance regression, **not evidence of superiority or parity
on representative user collections**. Real-world population benchmarks remain required for that
claim.

## Workload and retention scenarios

Web, Electron and mobile compare 80%, 90%, 95% and the selected retention target using identical
starting schedules, limits and seeded random draws. Each scenario shows answers, minutes and
final predicted recall; target retention is not a guarantee of the final recall estimate. The
daily detail includes siblings deferred by burying.

The first simulated day is the remainder of today's device-local study day; later boundaries
honor the configured day-start hour and daylight-saving transitions. Siblings follow each
subject's new/review/learning policy, including real answers already made today; learning retries
of the same card remain eligible. Shared note identities and legacy sibling groups are preserved
across subjects. Reduced-load weekday and policy time-zone rules already used by the scheduler
also apply to simulated review due dates; they shift dates rather than reducing the scenario's
daily answer cap.

The UI explicitly lists limitations: scenario limits override saved daily budgets, answers already
made today do not consume those scenario limits, active search filters and pause-new-when-overdue
are excluded, and review durations use valid recorded times or a stated 15-second default.
Simulations never append review evidence, change live schedules or apply fitted weights.
