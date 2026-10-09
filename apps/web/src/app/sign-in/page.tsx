import { redirect } from "next/navigation";
import { SignInScreen } from "@/components/auth/SignInScreen";
import { getOpenAiSignInCapabilities } from "@/lib/auth/openai-config";
import { openAiSignInMessage } from "@/lib/auth/openai-status";
import { sharedReturnPathFromQuery } from "@/lib/auth/return-path";
import { readSupabaseConfig } from "@/lib/supabase/config";

export default async function SignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}) {
  const query = await searchParams;
  const nextValues = typeof query.next === "string" ? [query.next] : (query.next ?? []);
  if (readSupabaseConfig()._tag === "Left") redirect(sharedReturnPathFromQuery(nextValues));
  const initialMessage =
    query.status === "provider-error"
      ? "Apple or Google sign-in could not be completed. Check the provider setup and try again."
      : openAiSignInMessage(query.openai);
  const chatGptEnabled = getOpenAiSignInCapabilities().enabled;
  return (
    <SignInScreen
      chatGptEnabled={chatGptEnabled}
      next={sharedReturnPathFromQuery(nextValues)}
      {...(initialMessage === undefined ? {} : { initialMessage })}
    />
  );
}
