/** Only known callback states become visible text; provider messages are untrusted. */
export function openAiSignInMessage(status: unknown): string | undefined {
  switch (status) {
    case "cancelled":
      return "ChatGPT authorization was cancelled. You can try again.";
    case "unavailable":
      return "ChatGPT sign-in is not available on this deployment yet.";
    case "temporarily-unavailable":
      return "ChatGPT authorization is temporarily unavailable. Please try again shortly.";
    case "expired":
      return "This ChatGPT authorization attempt expired. Please try again.";
    case "identity-conflict":
      return "This ChatGPT identity belongs to another Recall account. Sign in to that account or choose a different ChatGPT account.";
    case "linked":
      return "ChatGPT is linked to this account. You can use it the next time you sign in.";
    case "sign-in-required":
      return "Sign in to your Recall account before linking ChatGPT.";
    case "failed":
      return "ChatGPT authorization could not be completed. Try again.";
    default:
      return undefined;
  }
}
