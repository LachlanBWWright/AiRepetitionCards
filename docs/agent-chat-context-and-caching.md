# Agent chat context and caching

Desktop Tutor and Improve enforce an application limit of **100,000 input tokens**
per generation request. The count covers the actual request messages, developer
instructions, deck, and JSON output instructions. The desktop process calls
`POST /v1/responses/input_tokens` once when sending, using the same model and
request content as generation. Requests above the limit, or whose tokens cannot
be counted, do not proceed to generation. There are no token-count requests while
typing and no automatic retry loop.

ChatGPT plan usage does not support `max_output_tokens`. This is therefore an
input-context cap, not a guarantee on generated reasoning/output length. The
response token count appears separately in the meter and subsequent conversational
history is counted again before its next request. Recall does not silently drop
older chat turns to satisfy the former 40-message/48 KiB window. Transport/schema
safety ceilings remain separate from this token limit.

The pie shows the latest request's measured input tokens divided by 100,000.
It is neither cumulative billing nor an estimate of the unsent composer text.
Each response carries input, output, cache-read and cache-write token counts back
through the desktop bridge to the current chat. Missing cache telemetry is shown
as unavailable, rather than being inferred as a miss. Cached tokens still occupy
the context window.

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

The OAuth token-count endpoint and resulting cache hits have not been exercised
against a live account as part of this change.
