export type ChatGptPlanFailure = {
  readonly code: string;
  readonly status?: number;
  readonly recovery?: string;
};

/** Provider diagnostics remain at the boundary; UI receives actionable recovery text. */
export function chatGptPlanFailureMessage(failure: ChatGptPlanFailure): string {
  const { code, recovery, status } = failure;
  if (code === "local-ai-budget-exceeded")
    return "Your local AI request budget was reached. Review your local budget or wait for the next UTC budget period. ChatGPT's own limits are managed separately.";
  if (code === "local-ai-usage-unavailable")
    return "Local AI usage could not be saved or read. Requests are paused to preserve your budget; check local storage before retrying.";
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
  if (
    code === "subscription_sharing_usage_unavailable" ||
    code === "subscription_sharing_user_unavailable" ||
    recovery === "unavailable" ||
    status === 503
  )
    return "ChatGPT plan access is temporarily unavailable. Your credentials are preserved; wait before retrying. No billing source was changed.";
  if (code === "invalid-response" || code === "unknown-objective")
    return "The tutor response could not be validated. Try again.";
  return "ChatGPT tutoring could not complete this request. Check your connection and try again later.";
}
