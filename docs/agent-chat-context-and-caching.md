# Agent chat context and caching

Desktop Tutor and Improve send requests directly to `POST /v1/responses`.
ChatGPT plan credentials cannot use `POST /v1/responses/input_tokens`: the live
endpoint returns HTTP 401, `hardened_oauth_rule_missing`, with
`rejected_by_hardened_oauth_boundary`. Requiring that preflight blocked every
request before generation. There is no token-count preflight or local estimate.
Web managed AI and native ChatGPT already avoid this desktop-only preflight.

The selected model and provider enforce their context limits. The chart uses
100,000 tokens as a visual reference, not an application admission limit.
Transport/schema safety ceilings remain separate. ChatGPT plan usage does not
support `max_output_tokens`, so Recall does not send that parameter.

Each completed response supplies input, output, cache-read and cache-write token
counts through the desktop bridge. Missing telemetry remains unavailable rather
than being replaced by an estimate or zero. Cached tokens still occupy context.
Recall does not silently drop older chat turns to fit the chart reference.

## Prompt caching

The previous request format extended one JSON user message on every turn. On
GPT-5.6 and later, that can prevent reuse of an implicit cache boundary even when
the beginning of the text is unchanged. Tutor requests now separate stable task,
schema and deck data, contextual metadata, and individual dialogue messages.
Existing message boundaries remain intact when a new turn is appended. Imported
deck content remains user data; it is not promoted into developer instructions.

Caching uses the provider's default implicit behavior. No response cache or saved
chat transcript was introduced. `store: false` and fresh app sessions are distinct
from provider prompt-prefix caching. On GPT-5.6 and later, cacheable prefixes start
at 1,024 visible tokens and a routing key is not required for optimal cache reuse.
Changing the model or editing the deck changes the reusable prefix. Cache hits
are not guaranteed; the UI reports actual `cached_tokens` and `cache_write_tokens`
when present. Cache writes can carry a charge, so cache reads alone do not prove
net savings. Recall does not force unsupported extended-retention parameters.

Official references:

- [Counting tokens](https://developers.openai.com/api/docs/guides/token-counting)
- [Prompt caching and message boundaries](https://developers.openai.com/api/docs/guides/prompt-caching)
- [ChatGPT plan request restrictions](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)

The token-count rejection was verified against a live connected account. Cache
hits are not guaranteed.
