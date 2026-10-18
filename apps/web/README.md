# Recall Web

The web app shell and navigation are available without an account. Reading, creating, or studying cards requires a signed-in Recall account and a reachable API. Study data is saved to the account service; the browser keeps only a temporary in-memory working copy and does not persist cards, reviews, or attachments in browser storage.

From the repository root, run `pnpm dev:api:next` to start the ASP.NET API, Next.js client, and local Supabase stack when needed. Web sign-in supports Apple and Google, with direct ChatGPT sign-in available when its SIWC configuration is enabled. Configure the OAuth provider credentials you use in Supabase. See the root [README](../../README.md#supabase-and-account-sign-in) for setup details.

Mobile and Electron are the clients for local-only study. They keep their workspace in SQLite and can be used without an account.

Deck reports can be reviewed at `/moderation`. The API enforces operator access for the moderation queue and all changes; the web client does not assign moderation roles.

Web and Electron share dialog sizing: dialogs keep viewport margins and content padding, wrap long text and action rows, and scroll vertically when content exceeds the window height. Deck color choices wrap within the editor.

Tutor uses one shared shadcn tab bar for Practice, Quick questions, Materials and Suggestions. All Tutor selectors use the app-themed shadcn Select. Materials separate pasted notes from file import, with local text extraction and visible import guidance. Switching tabs preserves drafts.

When ChatGPT is selected, web research appears inside Materials alongside source import. Research does not add a separate page-level disclosure or navigation control.

Tutor keeps the goal, question, answer and feedback visible in Practice. Concepts, source details and notebook export/clear actions live in Materials; teaching metadata and request counters are not shown in the study flow. Tutor activities use ordinary sections rather than collapsibles.

On desktop, connecting ChatGPT automatically enables tutoring and research. There is no separate provider toggle. Tutor privacy and history deletion live in account settings; suggested practice topics live in Suggestions, leaving Quick questions focused on the question and answer.

The Practice study goal stays editable before and during a session. Save goal applies changes to future questions while keeping the current question, answer draft, materials, proposals and recorded answers. Starting practice also saves the current goal.

Each deck in Library has a Manage menu for editing its name and color, opening deck settings, or deleting it with confirmation. Review history is retained on deletion. The Shared library dialog separates browsing from publishing/importing; deck filters use the shared shadcn selects, and management/report forms open only when requested.

Practice has no app-imposed question, request-count or time caps. Existing saved notebooks automatically ignore their old session limits, without clearing answers or materials. Provider usage limits still apply.
