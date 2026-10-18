export function localTutorUnavailableReason(input: {
  readonly desktop: boolean;
  readonly state: {
    readonly activeClientId: string | null;
    readonly accounts: readonly {
      readonly clientId: string;
      readonly signedIn: boolean;
      readonly planEnabled: boolean;
    }[];
  } | null;
  readonly model: string;
  readonly error: string | null;
}): string | null {
  if (!input.desktop) return null;
  if (!input.state) return input.error ?? "Checking your ChatGPT connection…";
  const account = input.state.accounts.find(
    (item) => item.clientId === input.state?.activeClientId,
  );
  if (!account?.signedIn) return "Connect ChatGPT in Account → AI settings to begin.";
  if (!account.planEnabled)
    return "Enable ChatGPT plan tutoring in Account → AI settings to begin.";
  if (!input.model.trim())
    return input.error ?? "Choose an available ChatGPT model in Account → AI settings to begin.";
  return null;
}
