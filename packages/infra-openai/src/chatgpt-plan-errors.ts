export type ChatGptPlanFailure = {
  readonly code: string;
  readonly status?: number;
  readonly recovery?: string;
};

/** Provider diagnostics remain at the boundary; UI receives actionable recovery text. */
export function chatGptPlanFailureMessage(failure: ChatGptPlanFailure): string {
  const { code, recovery, status } = failure;
  if (code === "model-required")
    return "Choose an available ChatGPT model in Account → AI settings, then retry. Your message is preserved.";
  if (code === "invalid-tutor-request")
    return "Recall could not validate this tutor request before sending it. Check the subject’s cards and learning objectives, then retry. Your message is preserved.";
  if (code === "invalid-inference-request")
    return "Recall could not validate the desktop AI request before sending it. Reopen AI settings and choose an available model, then retry. Your message is preserved.";
  if (code === "secure-storage-unavailable")
    return "Unlock your OS keyring to securely save the ChatGPT connection, then retry.";
  if (code === "credential-storage-failed")
    return "The saved ChatGPT connection could not be read or saved. Check device storage and retry; existing credentials have been preserved.";
  if (code === "untrusted-sender")
    return "The desktop app could not verify this window. Restart Recall and try connecting again.";
  if (code === "local-ai-usage-unavailable")
    return "Recall could not save AI activity on this device. Check local storage and retry.";
  if (code === "context-limit-exceeded")
    return "This request exceeds the 100,000-token context limit. Shorten your message or start a fresh chat. Your current message is preserved.";
  if (code === "context-count-unavailable")
    return "OpenAI could not count this request’s tokens. Nothing was sent for generation because Recall could not verify the 100,000-token limit. Retry the request.";
  if (code === "request-timeout")
    return "ChatGPT took too long to respond. Your answer is preserved. Retry the request.";
  if (code === "network-unavailable")
    return "Recall could not reach OpenAI. Check your network connection and retry.";
  if (code === "inference-in-progress")
    return "A ChatGPT request is already running. Wait for it to finish before trying again.";
  if (
    [
      "interrupted-stream",
      "invalid-stream-type",
      "invalid-stream-event",
      "incomplete-response",
      "empty-response",
    ].includes(code)
  )
    return `ChatGPT did not return a complete answer (${code}). Your work is preserved; retry the request.`;
  if (code === "response-refused")
    return "ChatGPT declined this request. Revise the study question and try again.";
  if (code === "model-unavailable")
    return "This model is no longer available for your ChatGPT account. Open AI settings and choose an available model.";
  if (
    [
      "invalid-local-session",
      "invalid-session",
      "session-not-found",
      "session-area-mismatch",
    ].includes(code)
  )
    return "This practice session could not be restored for the selected deck. Start a new session; your saved notebook is preserved.";
  if (code === "question-required") return "Ask a question before submitting an answer.";
  if (code === "invalid_client")
    return "OpenAI rejected this saved client registration. Check distribution eligibility and registration configuration; repeated sign-in will not repair client configuration.";
  if (
    [
      "invalid_grant",
      "invalid_refresh_token",
      "token_expired",
      "refresh_token_expired",
      "refresh_token_invalidated",
      "refresh_token_reused",
    ].includes(code)
  )
    return "This ChatGPT session is no longer usable. Its credentials were cleared; sign in again using the saved account registration.";
  if (code === "inference-cancelled")
    return "The ChatGPT request stopped because the selected account changed or signed out.";
  if (code === "context-budget-exceeded")
    return "Required tutor context is too large. Shorten objective descriptions or AI instructions.";
  if (
    code === "subscription_sharing_usage_limit_exceeded" ||
    recovery === "usage-limit" ||
    code === "usage_limit_reached" ||
    code === "quota_exceeded"
  )
    return "Your ChatGPT app usage limit was reached. Pause plan tutoring and manage this app's limits in ChatGPT Settings → Usage. No reset time is assumed.";
  if (code === "subscription_sharing_user_not_eligible" || recovery === "ineligible")
    return "ChatGPT plan tutoring is unavailable for this account or workspace. Check eligibility and workspace policy, or explicitly select hosted tutoring. Signing in again will not change this restriction.";
  if (
    code === "subscription_sharing_unsupported_capability" ||
    code === "subscription_sharing_route_not_supported" ||
    recovery === "unsupported"
  )
    return "This ChatGPT request uses an unsupported capability or route. Choose another supported model or explicitly select hosted tutoring; repeating the same request will not fix it.";
  if (
    code === "chatpass_v2_scope_not_authorized" ||
    code === "chatpass_v2_invalid_authorization_context" ||
    recovery === "permission" ||
    status === 403
  )
    return "ChatGPT rejected this request because of permission, workspace policy or serving-region restrictions. Check the account's grant and supported region; no billing source was changed.";
  if (code === "subscription_sharing_invalid_user" || recovery === "identity" || status === 401)
    return "ChatGPT could not validate this account's permission. Check the selected account and grant; reconnect after confirmed disconnection or an expired session.";
  if (
    code === "sign-in-required" ||
    code === "plan-consent-required" ||
    code === "plan-permission-required" ||
    code === "refresh-permission-required" ||
    code === "chatgpt-account-changed" ||
    code === "account-changed"
  )
    return "Select your ChatGPT account and enable plan tutoring again.";
  if (code === "rate_limit_exceeded" || recovery === "rate-limit" || status === 429)
    return "ChatGPT is temporarily rate limited. Pause requests and try again later.";
  if (["invalid-response", "invalid-provider-response", "unknown-objective"].includes(code))
    return "ChatGPT returned an answer that did not match the requested study task. Nothing was saved from that response. Retry the request.";
  if (
    [
      "invalid-request",
      "invalid_request_error",
      "unsupported_parameter",
      "invalid_parameter",
      "unsupported_value",
      "invalid_value",
    ].includes(code) ||
    status === 400
  )
    return `OpenAI rejected the tutor request (${/^[a-z][a-z0-9_.-]{0,127}$/.test(code) ? code : "invalid-request"}). This is a request-format error, not a connection failure.`;
  if (
    code === "subscription_sharing_usage_unavailable" ||
    code === "subscription_sharing_user_unavailable" ||
    recovery === "unavailable" ||
    status === 503
  )
    return "ChatGPT plan access is temporarily unavailable. Your credentials are preserved; wait before retrying. No billing source was changed.";
  const diagnostic = /^[a-z][a-z0-9_.-]{0,127}$/.test(code) ? code : "unclassified-error";
  return `Recall could not complete the ChatGPT request. Error: ${diagnostic}${status ? ` (HTTP ${String(status)})` : ""}. Your work is preserved.`;
}
