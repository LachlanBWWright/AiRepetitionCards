/** Only known callback states become visible text; provider messages are untrusted. */
export function openAiSignInMessage(status: unknown): string | undefined {
  switch (status) {
    case "cancelled":
      return "ChatGPT sign-in was cancelled. You can try again or use an email link.";
    case "unavailable":
      return "ChatGPT sign-in is not available on this deployment yet. You can use an email link.";
    case "temporarily-unavailable":
      return "ChatGPT sign-in is temporarily unavailable. Please start again shortly or use an email link.";
    case "expired":
      return "This ChatGPT sign-in attempt expired. Please start again.";
    case "identity-conflict":
      return "This ChatGPT identity belongs to another Recall account. Sign in to that account or choose a different ChatGPT account.";
    case "linked":
      return "ChatGPT is linked to this account. You can use it the next time you sign in.";
    case "sign-in-required":
      return "Sign in to your Recall account before linking ChatGPT.";
    case "failed":
      return "ChatGPT sign-in could not be completed. Try again or use an email link.";
    default:
      return undefined;
  }
}
