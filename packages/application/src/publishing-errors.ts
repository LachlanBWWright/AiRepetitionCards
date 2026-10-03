import type { PublishingApiFailure } from "./publishing-api";

/** Give publishers a recovery action appropriate to the validated failure. */
export function publicationFailureMessage(failure: PublishingApiFailure): string {
  if (failure._tag === "PublishingTransportFailure")
    return "The publishing service could not be reached. Retry when connected.";
  if (failure.reason !== "http")
    return failure.reason === "invalid-request"
      ? "Check this area's content, license and permission to publish before trying again."
      : "The publication response could not be validated. Retry the saved publish attempt.";
  if (failure.status === 401 || failure.code === "unauthenticated")
    return "Sign in to publish this Knowledge Area.";
  switch (failure.code) {
    case "workspace-account-changed":
      return "The signed-in account changed. Reopen the area under its owning account before retrying.";
    case "area-not-found":
      return "Sync this Knowledge Area before publishing it.";
    case "publication-rights-required":
      return "Choose a license and confirm that you have permission to publish this content.";
    case "publication-lineage-mismatch":
      return "This area's source metadata is inconsistent. Reopen the area and check its source before publishing.";
    case "source-version-not-found":
      return "The source publication is unavailable. Check your access while keeping its attribution and license.";
    case "version-conflict":
      return "Another publication changed this area's version. Retry the saved publish attempt.";
    case "publication-operation-conflict":
      return "This draft differs from the saved publish attempt. Restore the original draft or deliberately start a new attempt; the earlier publication may already exist.";
    case "media-not-uploaded":
      return "An attachment is missing from the publication upload. Restore it locally and try again.";
    case "media-integrity-failed":
      return "An attachment failed validation. Replace the damaged attachment before publishing.";
    case "media-limits-exceeded":
    case "request-too-large":
    case "media-too-large":
      return "This publication exceeds the size limit. Remove attachments or reduce the area before publishing.";
    case "invalid-request":
    case "invalid-publication":
      return "Check this area's content and publication settings before trying again.";
  }
  if (failure.status === 403)
    return "This account does not have permission to publish this area. Check the selected account.";
  if (failure.status === 429)
    return "Too many publishing requests were made. Pause and retry the saved attempt later.";
  return "The publication could not be saved yet. Retry the saved publish attempt.";
}
