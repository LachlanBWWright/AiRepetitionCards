import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.resolve(appRoot, "../../artifacts/storybook-screenshots");
const port = Number(process.env.STORYBOOK_PORT ?? 6006);
const baseUrl = `http://127.0.0.1:${port}`;
const requested = [
  ...[
    ["Usage", "ai-budget-usage.png"],
    ["Unlimited", "ai-budget-unlimited.png"],
    ["Blocked", "ai-budget-blocked.png"],
    ["Save Unavailable", "ai-budget-save-unavailable.png"],
  ].map(([name, file]) => ({
    title: "Screens/AI Budget Settings",
    name,
    file,
    viewport: { width: 1440, height: 1000 },
  })),
  ...[
    ["Browser Enabled", "daily-reminder-browser.png"],
    ["Desktop Enabled", "daily-reminder-desktop.png"],
    ["Disabled", "daily-reminder-disabled.png"],
    ["Blocked", "daily-reminder-blocked.png"],
  ].map(([name, file]) => ({
    title: "Screens/Daily Study Reminders",
    name,
    file,
    viewport: { width: 1440, height: 1000 },
  })),
  ...[
    ["Materials · paste or import", "study-materials-ready.png"],
    ["Materials · extracted PDF preview", "study-materials-preview.png"],
    ["Materials · source-backed proposals", "study-materials-proposals.png"],
    ["Materials · interrupted batch retained", "study-materials-resume.png"],
    ["Materials · budget exhausted", "study-materials-budget.png"],
    ["Materials · local OCR correction", "study-materials-ocr.png"],
  ].map(([name, file]) => ({
    title: "Screens/Study Materials",
    name,
    file,
    viewport: { width: 1440, height: 1200 },
  })),
  ...[
    ["Notebook · ready to investigate", "knowledge-notebook-ready.png"],
    ["Notebook · code question and confidence", "knowledge-notebook-question.png"],
    ["Notebook · misconceptions and evidence", "knowledge-notebook-gaps.png"],
    ["Notebook · editable card proposals", "knowledge-notebook-proposals.png"],
    ["Notebook · finished and ready to review", "knowledge-notebook-finished.png"],
  ].map(([name, file]) => ({
    title: "Screens/Knowledge Notebook",
    name,
    file,
    viewport: { width: 1440, height: 1200 },
  })),
  ...[
    ["Research · ready to search", "desktop-chatgpt-research-ready.png"],
    ["Research · source citations", "desktop-chatgpt-research-citations.png"],
    [
      "Research · search unavailable for selected model",
      "desktop-chatgpt-research-unavailable.png",
    ],
    ["Research · failed search preserves results", "desktop-chatgpt-research-retry.png"],
  ].map(([name, file]) => ({
    title: "Screens/Desktop ChatGPT Research",
    name,
    file,
    viewport: { width: 1440, height: 1100 },
  })),
  ...[
    ["Navigation · Local account (native)", "native-local-account.png"],
    ["Navigation · Local tutor unavailable (native)", "native-local-tutor.png"],
    ["Navigation · Local sharing (native)", "native-local-sharing.png"],
  ].map(([name, file]) => ({
    title: "Screens/Native App Shell",
    name,
    file,
    viewport: { width: 390, height: 1000 },
  })),
  {
    title: "Screens/Sign In",
    name: "Sign in · local study without an account",
    file: "web-local-study.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Native App Shell",
    name: "Navigation · Card attachments (native)",
    file: "native-card-attachments.png",
    viewport: { width: 390, height: 1200 },
  },
  {
    title: "Screens/Native App Shell",
    name: "Navigation · Today (native)",
    file: "native-navigation-today.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native App Shell",
    name: "Navigation · Library (native)",
    file: "native-navigation-library.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native App Shell",
    name: "Navigation · Tutor (native)",
    file: "native-navigation-tutor.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native App Shell",
    name: "Navigation · Sharing (native)",
    file: "native-navigation-sharing.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native App Shell",
    name: "Navigation · Account (native)",
    file: "native-navigation-account.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · request throttled preserves draft",
    file: "web-tutor-throttled.png",
    viewport: { width: 1440, height: 1100 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · limiter unavailable preserves draft",
    file: "web-tutor-limiter-unavailable.png",
    viewport: { width: 1440, height: 1100 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · request throttled preserves draft (native)",
    file: "native-tutor-throttled.png",
    viewport: { width: 390, height: 1200 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · limiter unavailable preserves draft (native)",
    file: "native-tutor-limiter-unavailable.png",
    viewport: { width: 390, height: 1200 },
  },

  {
    title: "Knowledge/Area settings",
    name: "Conflict",
    file: "area-settings-stale-draft.png",
    viewport: { width: 1440, height: 1100 },
  },
  {
    title: "Knowledge/Area settings",
    name: "Save Failure",
    file: "area-settings-save-failure.png",
    viewport: { width: 1440, height: 1100 },
  },
  {
    title: "Knowledge/Review settings",
    name: "Conflict",
    file: "review-settings-stale-draft.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Knowledge/Review settings",
    name: "Save Failure",
    file: "review-settings-save-failure.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Knowledge/Area settings",
    name: "Imported Tags",
    file: "area-settings-imported-tags.png",
    viewport: { width: 1440, height: 1100 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Imported Card Tags",
    file: "native-authoring-imported-card-tags.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Imported Area Tags",
    file: "native-authoring-imported-area-tags.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Review Retention Default",
    file: "native-authoring-review-retention-default.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Review Retention High",
    file: "native-authoring-review-retention-high.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Review Retention Save Failure",
    file: "native-authoring-review-retention-save-failure.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Objective Filtered Library",
    file: "native-authoring-objective-filtered-library.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Combined Search And Objective Filter",
    file: "native-authoring-combined-search-and-objective-filter.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Practice Insights",
    name: "Recorded History",
    file: "native-practice-recorded-history.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Practice Insights",
    name: "Empty History",
    file: "native-practice-empty-history.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Practice Insights",
    name: "Deleted Area History",
    file: "native-practice-deleted-area-history.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · tentative evaluation (native)",
    file: "native-tutor-tentative-evaluation.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · tentative completed quiz feedback (native)",
    file: "native-tutor-tentative-completed-quiz-feedback.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · hosted daily token budget exhausted",
    file: "tutor-hosted-daily-token-budget-exhausted.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · hosted budget storage unavailable",
    file: "tutor-hosted-budget-storage-unavailable.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Card Library",
    file: "native-authoring-card-library.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Empty Library",
    file: "native-authoring-empty-library.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Basic Card Editor",
    file: "native-authoring-basic-card-editor.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Cloze Card Editor",
    file: "native-authoring-cloze-card-editor.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Area Metadata And Objectives",
    file: "native-authoring-area-metadata-and-objectives.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Rename Area",
    file: "native-authoring-rename-area.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Confirm Area Deletion",
    file: "native-authoring-confirm-area-deletion.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Confirm Card Deletion",
    file: "native-authoring-confirm-card-deletion.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Persistence Failure",
    file: "native-authoring-persistence-failure.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Workspace Authoring",
    name: "Saving Disabled",
    file: "native-authoring-saving-disabled.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · edited Basic proposal (native)",
    file: "native-tutor-edited-proposal.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · invalid proposal edit (native)",
    file: "native-tutor-invalid-proposal-draft.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · edited proposal save failure (native)",
    file: "native-tutor-proposal-save-failure.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Today · deleted card review waiting for sync (native)",
    file: "native-deleted-card-review-pending.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Today · deleted area review waiting for sync (native)",
    file: "native-deleted-area-review-pending.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Today · missing deleted review content recovery (native)",
    file: "native-deleted-review-recovery.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · changed area preserves draft",
    file: "area-stale-draft.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · area save failure preserves draft",
    file: "area-save-failure.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · retry failed area deletion",
    file: "area-delete-failure.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · retry failed card deletion",
    file: "card-delete-failure.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Insights · offline deleted card pending first sync",
    file: "insights-deleted-card-pending-sync.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Insights · offline deleted area pending first sync",
    file: "insights-deleted-area-pending-sync.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Insights · older deleted review content recovery",
    file: "insights-deleted-review-recovery.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · saving review before advancing",
    file: "today-review-saving.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · retry failed review save",
    file: "today-review-save-recovery.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Explore · pending review recovery",
    file: "explore-review-save-recovery.png",
    viewport: { width: 1440, height: 1000 },
  },
  ...[
    ["upstream update available", "upstream-update-available"],
    ["no public upstream update", "no-public-upstream-update"],
    ["upstream source unavailable", "upstream-source-unavailable"],
    ["upstream check failed", "upstream-check-failed"],
  ].flatMap(([label, file]) => [
    {
      title: "Screens/Knowledge Area Sharing",
      name: `Share · ${label}`,
      file: `share-${file}.png`,
      viewport: { width: 1440, height: 1000 },
    },
    {
      title: "Screens/Native Publishing",
      name: `Publishing · ${label} (native)`,
      file: `native-${file}.png`,
      viewport: { width: 390, height: 844 },
    },
  ]),
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · weak second objective (native)",
    file: "native-tutor-weak-second-objective.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · newer workspace saved in another tab",
    file: "today-stale-tab-recovery.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · different account workspace",
    file: "today-workspace-account-mismatch.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · confirm older workspace ownership",
    file: "today-workspace-owner-adoption.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · account binding storage failure",
    file: "today-workspace-binding-storage-failure.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · 500-card context selection",
    file: "tutor-500-card-context.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · recover interrupted publication",
    file: "share-publication-recovery.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · changed pending publication",
    file: "share-publication-changed-draft.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · preserve inherited rights",
    file: "share-inherited-rights.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · choose permission and license",
    file: "share-unknown-rights.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · local cleanup recovery",
    file: "today-local-cleanup-recovery.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · approval storage failure",
    file: "tutor-approval-storage-failure.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · approval retry",
    file: "tutor-approval-retry.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · corrected proposal objective",
    file: "tutor-proposal-objective-correction.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · multiple quiz answer drafts",
    file: "tutor-multiple-quiz-drafts.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · next answer draft retained after evaluation",
    file: "tutor-quiz-draft-after-evaluation.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · unavailable proposal objective",
    file: "tutor-proposal-unavailable-objective.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · long session context window",
    file: "tutor-long-session-window.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Shared UI/Button",
    name: "Full-screen · composition and variants",
    file: "shared-ui-button-composition.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Tutor Privacy",
    name: "Retention Policy",
    file: "tutor-privacy-retention.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Tutor Privacy",
    name: "Confirm Clear",
    file: "tutor-privacy-confirm-clear.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Tutor Privacy",
    name: "Clear Failed",
    file: "tutor-privacy-clear-failed.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Tutor Privacy",
    name: "Cleared",
    file: "tutor-privacy-cleared.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Tutor Privacy",
    name: "Local Account",
    file: "tutor-privacy-local-account.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Connect",
    file: "desktop-chatgpt-connect.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Plan Ready",
    file: "desktop-chatgpt-ready.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Multiple Accounts",
    file: "desktop-chatgpt-accounts.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Usage Limit",
    file: "desktop-chatgpt-usage-limit.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Ineligible Account",
    file: "desktop-chatgpt-ineligible.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Permission Restriction",
    file: "desktop-chatgpt-permission.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Temporarily Unavailable",
    file: "desktop-chatgpt-unavailable.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Revocation Unconfirmed",
    file: "desktop-chatgpt-revocation-unconfirmed.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Plan Selected Without Access",
    file: "desktop-chatgpt-selected-without-access.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Models Unavailable",
    file: "desktop-chatgpt-models-unavailable.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "Usage Paused",
    file: "desktop-chatgpt-usage-paused.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "First Plan Sign In",
    file: "desktop-chatgpt-first-sign-in.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Desktop ChatGPT Plan",
    name: "First Sign In With Catalog Unavailable",
    file: "desktop-chatgpt-first-sign-in-catalog-unavailable.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Sign In",
    name: "Sign in · ChatGPT available",
    file: "sign-in-chatgpt-available.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Sign In",
    name: "Sign in · ChatGPT unavailable",
    file: "sign-in-chatgpt-unavailable.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Sign In",
    name: "Sign in · authorization cancelled",
    file: "sign-in-chatgpt-cancelled.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Sign In",
    name: "Sign in · temporary provider outage",
    file: "sign-in-chatgpt-temporarily-unavailable.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/ChatGPT Account Connection",
    name: "Account · link ChatGPT",
    file: "account-link-chatgpt.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/ChatGPT Account Connection",
    name: "Account · ChatGPT linked",
    file: "account-chatgpt-linked.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/ChatGPT Account Connection",
    name: "Account · ChatGPT already linked elsewhere",
    file: "account-chatgpt-conflict.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Native UI/Primitives",
    name: "Study Actions",
    file: "native-ui-study-actions.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Native UI/Primitives",
    name: "Caught Up",
    file: "native-ui-caught-up.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Native UI/Primitives",
    name: "Offline Library",
    file: "native-ui-offline-library.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Shared UI/Button",
    name: "Full-screen · action states",
    file: "shared-ui-action-states.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Shared UI/Empty State",
    name: "Full-screen · empty and recovery states",
    file: "shared-ui-empty-recovery.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Shared UI/Status Badge",
    name: "Full-screen · synchronization status",
    file: "shared-ui-sync-status.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Shared UI/Dialog",
    name: "Full-screen · delete confirmation",
    file: "shared-ui-delete-confirmation.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Shared UI/Dialog",
    name: "Full-screen · recoverable error",
    file: "shared-ui-recoverable-error.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Shared UI/Dialog",
    name: "Full-screen · pending deletion",
    file: "shared-ui-pending-deletion.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · restored session evidence",
    file: "tutor-restored-session-evidence.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · accumulated quiz evidence",
    file: "tutor-accumulated-quiz-evidence.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Insights · daily and weekly practice",
    file: "insights-daily-weekly-practice.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Knowledge/Review settings",
    name: "Default Retention",
    file: "review-settings-default-retention.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Knowledge/Review settings",
    name: "High Retention",
    file: "review-settings-high-retention.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Knowledge/Review settings",
    name: "Fractional Retention",
    file: "review-settings-fractional-retention.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Study · Cloze question",
    file: "study-cloze-question.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Study · Cloze answer",
    file: "study-cloze-answer.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · edit Cloze card",
    file: "card-edit-cloze.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · edit card objectives and tags",
    file: "card-edit-objectives-tags.png",
    viewport: { width: 1440, height: 1000 },
  },

  {
    title: "Screens/Recall Dashboard",
    name: "Library · changed card preserves draft",
    file: "card-edit-stale-draft.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · weak quiz result with card action",
    file: "tutor-weak-quiz-card-action.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · weak quiz result with card action (native)",
    file: "native-tutor-weak-quiz-card-action.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Card Library",
    name: "Library · due and scheduled cards",
    file: "card-library-all-cards.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Knowledge/Area settings",
    name: "Complete",
    file: "area-settings-objectives-ai.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · compare upstream update",
    file: "share-compare-upstream-update.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Study · saving review (native)",
    file: "native-study-saving-review.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Today · offline study (native)",
    file: "mobile-today-offline.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native AI Tutor",
    name: "Tutor · proposal approval (native)",
    file: "native-tutor-proposal-approval.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Publishing",
    name: "Publishing · share and receive (native)",
    file: "native-publishing-share-receive.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Publishing",
    name: "Publishing · compare upstream update (native)",
    file: "native-publishing-compare-upstream.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Account",
    name: "Account · workspace owner mismatch (native)",
    file: "native-account-owner-mismatch.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Account",
    name: "Account · legacy owner confirmation (native)",
    file: "native-account-owner-confirmation.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Native Account",
    name: "Account · deletion confirmation (native)",
    file: "native-account-delete-confirmation.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Study · answer revealed (native)",
    file: "mobile-study-answer-revealed.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Study · card with media (native)",
    file: "mobile-study-card-with-media.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Study · caught up (native)",
    file: "mobile-study-caught-up.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Account",
    name: "Account · export data",
    file: "account-export.png",
    viewport: { width: 1440, height: 900 },
  },
  {
    title: "Screens/Account",
    name: "Account · delete confirmation",
    file: "account-delete-confirmation.png",
    viewport: { width: 1440, height: 900 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · desktop",
    file: "today-desktop.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · mobile",
    file: "today-mobile.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Study · answer revealed",
    file: "study-answer-revealed.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Study · card with media",
    file: "study-card-with-media.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Study · caught up",
    file: "study-caught-up.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Explore · learning areas",
    file: "explore-learning-areas.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · edit learning area",
    file: "area-edit-dialog.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · add card with media",
    file: "card-add-media.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Insights · practice summary",
    file: "insights-practice-summary.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Insights · review sync conflict",
    file: "sync-conflict-review.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · empty library",
    file: "today-empty-library.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Design System/Button",
    name: "Full-screen · action catalog",
    file: "components-action-catalog.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Design System/Feedback",
    name: "Full-screen · feedback catalog",
    file: "components-feedback-catalog.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Design System/Review Card",
    name: "Full-screen · study card catalog",
    file: "components-study-card-catalog.png",
    viewport: { width: 1440, height: 1200 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · start",
    file: "tutor-start.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Design System/Review Card",
    name: "Multiline answer",
    file: "study-card-multiline-answer.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · atomic copy save recovery",
    file: "share-copy-save-recovery.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · answer feedback",
    file: "tutor-answer-feedback.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · card proposal",
    file: "tutor-card-proposal.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · objective gaps",
    file: "tutor-objective-gaps.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · imported objective gaps",
    file: "tutor-imported-objective-gaps.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · targeted quiz",
    file: "tutor-targeted-quiz.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · targeted quiz feedback",
    file: "tutor-targeted-quiz-feedback.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · daily limit reached",
    file: "tutor-daily-limit.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · publish area",
    file: "share-publish-area.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · review attribution and license",
    file: "share-review-attribution-license.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · review media attachment",
    file: "share-review-media-attachment.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · active unlisted link",
    file: "share-active-unlisted-link.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · revoked unlisted link",
    file: "share-revoked-unlisted-link.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Anki Import",
    name: "Anki · choose package",
    file: "anki-import-choose-package.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Anki Import",
    name: "Anki · review imported cards",
    file: "anki-import-review-cards.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Anki Import",
    name: "Anki · unsupported package",
    file: "anki-import-unsupported-package.png",
    viewport: { width: 1440, height: 1000 },
  },
];

const screenRoots = {
  "Screens/Recall Dashboard": ".app-shell",
  "Screens/Sign In": ".auth-page .auth-panel",
  "Screens/ChatGPT Account Connection": ".auth-page .auth-panel",
  "Screens/Native App Shell": '[aria-label="Main navigation"]',
  "Screens/Native AI Tutor": '[data-testid="native-tutor-panel"]',
  "Screens/Native Publishing": '[data-testid="native-publishing-panel"]',
  "Screens/Native Account": '[data-testid="native-account-panel"]',
  "Screens/Native Workspace Authoring": '[data-testid="native-workspace-authoring"]',
  "Screens/Native Practice Insights": 'main:has-text("Your practice")',
  "Screens/Mobile Client": '[data-testid="mobile-screen"]',
  "Screens/Knowledge Area Sharing": ".publication-panel",
  "Screens/Anki Import": ".anki-import-dialog",
  "Screens/AI Tutor": ".component-catalog .tutor-panel",
  "Screens/Tutor Privacy": ".component-catalog .tutor-panel",
  "Screens/Desktop ChatGPT Plan": ".component-catalog",
  "Screens/Desktop ChatGPT Research": ".component-catalog .tutor-panel",
  "Screens/Knowledge Notebook": ".component-catalog .tutor-panel",
  "Screens/AI Budget Settings": ".component-catalog .tutor-panel",
  "Screens/Daily Study Reminders": ".component-catalog .tutor-panel",
  "Screens/Study Materials": ".component-catalog .tutor-panel",
  "Screens/Account": ".component-catalog .account-action",
  "Screens/Card Library": '.component-catalog section:has-text("Your cards")',
  "Knowledge/Area settings": 'main:has-text("Knowledge area settings")',
  "Knowledge/Review settings": 'main:has-text("Review settings")',
  "Native UI/Primitives": '#storybook-root > div:has-text("Your study space")',
  "Design System/Button": ".component-catalog",
  "Design System/Feedback": ".component-catalog",
  "Design System/Review Card": ".component-catalog",
  "Shared UI/Button": ".component-catalog",
  "Shared UI/Dialog": ".component-catalog",
  "Shared UI/Empty State": ".component-catalog",
  "Shared UI/Status Badge": ".component-catalog",
};

function screenRoot(shot) {
  if (shot.title === "Design System/Review Card" && shot.name === "Multiline answer")
    return ".study-card";
  return screenRoots[shot.title];
}

async function waitForScreenState(page, shot) {
  if (shot.title === "Screens/Native App Shell") {
    const tab =
      shot.name.includes("account") || shot.name.includes("Account")
        ? "account"
        : shot.name.includes("tutor") || shot.name.includes("Tutor")
          ? "tutor"
          : shot.name.includes("sharing") || shot.name.includes("Sharing")
            ? "publishing"
            : shot.name.includes("Library") || shot.name.includes("attachments")
              ? "workspace-authoring"
              : null;
    const content = tab ? `[data-testid="native-${tab}-panel"]` : '[data-testid="mobile-screen"]';
    await page
      .locator(
        tab === "workspace-authoring" ? '[data-testid="native-workspace-authoring"]' : content,
      )
      .waitFor({ state: "visible", timeout: 20_000 });
  }
  if (shot.title !== "Screens/Native AI Tutor") return;
  const root = page.locator('[data-testid="native-tutor-panel"]');
  if (/proposal|throttled|limiter/.test(shot.name)) {
    await root
      .getByText("Proposed card · approval required", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
  } else if (shot.name.includes("tentative")) {
    await root
      .getByText("This assessment is tentative. Ask for clarification or try another answer.", {
        exact: true,
      })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
  } else if (shot.name.includes("weak quiz")) {
    await root
      .getByText("Your answer: DNA", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
  } else if (shot.name.includes("weak second objective")) {
    await root
      .getByText("Practice target: Gene expression", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
  }
}

let server;
let browser;

async function waitForStorybook() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) {
      return { ok: false, message: `Storybook exited with code ${server.exitCode}` };
    }
    try {
      const response = await fetch(`${baseUrl}/index.json`);
      if (response.ok) return { ok: true, index: await response.json() };
    } catch {
      // Keep waiting while the local Storybook server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, message: `Storybook did not become ready at ${baseUrl}` };
}

let runError;

try {
  await mkdir(outputDir, { recursive: true });
  server = spawn(
    process.execPath,
    [
      path.resolve(appRoot, "node_modules/storybook/dist/bin/dispatcher.js"),
      "dev",
      "--ci",
      "--no-open",
      "--port",
      String(port),
    ],
    {
      cwd: appRoot,
      stdio: "inherit",
    },
  );

  const startup = await waitForStorybook();
  if (!startup.ok) {
    runError = startup.message;
  } else {
    const entries = Object.values(startup.index?.entries ?? {});
    browser = await chromium.launch({ headless: true });

    for (const shot of requested) {
      const story = entries.find(
        (entry) => entry.type === "story" && entry.title === shot.title && entry.name === shot.name,
      );
      if (!story) {
        runError = `Story not found: ${shot.name}`;
        break;
      }

      const page = await browser.newPage({
        viewport: shot.viewport,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: "light",
      });
      await page.goto(`${baseUrl}/iframe.html?id=${story.id}&viewMode=story`, {
        waitUntil: "networkidle",
      });
      const screenSelector = screenRoot(shot);
      if (!screenSelector) {
        runError = `No screen readiness mapping for ${shot.title}`;
        await page.close();
        break;
      }
      await page.locator(screenSelector).waitFor({ state: "visible", timeout: 20_000 });
      await waitForScreenState(page, shot);
      if (shot.title === "Screens/Recall Dashboard" && shot.viewport.width < 720) {
        await page.addStyleTag({
          content: ".mobile-footer { position: static !important; inset: auto !important; }",
        });
      }
      await page.waitForTimeout(250);
      await page.screenshot({
        path: path.join(outputDir, shot.file),
        fullPage: true,
        animations: "disabled",
      });
      await page.close();
      console.log(
        `Saved ${path.relative(path.resolve(appRoot, "../.."), path.join(outputDir, shot.file))}`,
      );
    }

    if (!runError) {
      const screenshotList = requested.map((shot) => `- [${shot.name}](./${shot.file})`).join("\n");
      await writeFile(
        path.join(outputDir, "README.md"),
        `# Storybook screenshots\n\nGenerated from full-screen Storybook stories with deterministic mock data. Rebuild them with \`pnpm screenshots\` from the repository root.\n\n${screenshotList}\n`,
      );
    }
  }
} catch (error) {
  runError = error instanceof Error ? error.message : "Storybook screenshot capture failed";
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        server?.kill("SIGKILL");
        resolve();
      }, 5_000);
      server?.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

if (runError) {
  process.stderr.write(`${runError}\n`);
  process.exitCode = 1;
}
