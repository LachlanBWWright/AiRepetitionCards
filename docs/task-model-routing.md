# Hosted tutor model routing

The hosted OpenAI adapter supports questions, answer evaluation, card proposals and targeted quizzes. Its portable capability contract reports structured outputs, non-streamed replies, a 96,000-byte serialized input limit and a maximum output budget of 2,600 tokens. These describe this adapter's enforced behavior, rather than every feature of an OpenAI model.

Configure models on the web server:

| Setting                   | Operations                       | Fallback       |
| ------------------------- | -------------------------------- | -------------- |
| `OPENAI_TUTOR_MODEL`      | Questions and targeted quizzes   | `OPENAI_MODEL` |
| `OPENAI_EVALUATION_MODEL` | Tutor and quiz answer evaluation | `OPENAI_MODEL` |
| `OPENAI_PROPOSAL_MODEL`   | Card proposals                   | `OPENAI_MODEL` |

An unset or empty override uses the fallback. Invalid explicit values disable their task before a quota reservation or provider call. Choose models that support the requested Responses API structured-output format; model availability and account permissions are validated by the provider when called. Secrets and model configuration stay on the server.

The route reserves each call against the model selected for that operation, and the adapter records that same model with returned usage. Questions allow 1,200 output tokens, evaluations 1,800, and proposals/quizzes 2,600. Oversized serialized context fails with a typed quota error. These limits bound each call; the existing atomic daily Supabase quota counts calls and records verified token usage.

Eligible desktop ChatGPT-plan mode retains its documented model discovery and selection. Hosted model settings do not select or authorize local plan models. Regular flashcard reviews invoke neither provider.

## Daily hosted budgets

Set `AI_DAILY_TOKEN_BUDGET` to enable per-account daily admission budgeting, and optionally `AI_DAILY_REQUEST_LIMIT` to impose a lower request ceiling (1–30). Either setting requires server-only `AI_BUDGET_STORE_REST_URL` and `AI_BUDGET_STORE_REST_TOKEN`, using an HTTPS Redis REST service with atomic `EVAL` support. `AI_BUDGET_STORE_PREFIX` defaults to `recall:ai-budget`; use distinct prefixes per environment. Unset limits preserve the existing 30-call Supabase quota. Invalid limits or unavailable configured storage stop inference.

Immediately before the provider request, an atomic operation reserves the complete serialized request's UTF-8 byte length plus its enforced maximum output tokens. These are deliberately conservative admission units, not an exact tokenizer estimate or a guarantee about provider billing. Known input/output usage replaces the hold atomically; concurrent requests count outstanding holds. Usage above the reservation is recorded and stops the workflow instead of hiding the excess. Missing usage and ambiguous network failures retain the full hold. Rejected or invalid responses with verified usage still charge that usage. Request counts are never refunded.

Counters are scoped to the verified application account and the UTC day of admission. Idempotent call IDs prevent duplicate reservations or settlement refunds. Requests finishing after midnight settle their original day; unrelated deployments share a quota only when configured with the same durable store and prefix. Records expire after three days. Protect Redis against eviction and data loss; losing its records loses budget history. The existing Supabase quota and usage records remain an independent limit and accounting source. Desktop ChatGPT-plan inference is governed by its account's plan and does not use this hosted budget.
