# Tutor context selection

Canonical learning content and stored tutor area snapshots remain complete. Shared inference selection has an 80,000-byte UTF-8 JSON budget, leaving room inside the provider's 96,000-byte limit for local request instructions and response schemas.

Selection retains objective definitions and identities, AI policies, operation-specific answer/evaluation evidence, and the newest two dialogue messages. When a complete area exceeds the budget, it omits area description/tags, prioritizes cards linked to the requested or observed objective, then uses stable card ID order. It reserves room for recent dialogue and appends earlier messages newest first while retaining chronological order. Selection never changes the canonical deck or schedules.

Hosted clients compact initial transport before HTTP submission and fingerprint the full canonical document. The authenticated server reads the latest version from the explicitly owned area and checks that fingerprint before constructing a full session snapshot. Large unsynchronized areas, or changes newer than the synchronized version, require synchronization first. Existing sessions use their full stored snapshot. Local ChatGPT sessions retain their full local snapshot and use the same inference selection without requiring cloud sync.

If required policy/objective/evidence data alone exceeds the budget, a typed context-budget failure asks the learner to shorten objective descriptions or AI instructions. This is separate from hosted provider funding/quota exhaustion. The full-screen 500-card Storybook state displays the selection count; its screenshot target is registered without running a browser.
