import { SignInScreen } from "@/components/auth/SignInScreen";
import { getOpenAiSignInCapabilities } from "@/lib/auth/openai-config";
import { openAiSignInMessage } from "@/lib/auth/openai-status";
import { sharedReturnPathFromQuery } from "@/lib/auth/return-path";

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}) {
  const query = await searchParams;
  const nextValues = typeof query.next === "string" ? [query.next] : (query.next ?? []);
  const capabilities = getOpenAiSignInCapabilities();
  const initialMessage = openAiSignInMessage(query.openai);
  return (
    <SignInScreen
      chatGptEnabled={capabilities.enabled}
      next={sharedReturnPathFromQuery(nextValues)}
      {...(initialMessage === undefined ? {} : { initialMessage })}
    />
  );
}
