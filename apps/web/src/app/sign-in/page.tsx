import { redirect } from "next/navigation";
import { SignInScreen } from "@/components/auth/SignInScreen";
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
  const initialMessage = query.status
    ? "Google sign-in could not be completed. Please try again."
    : undefined;
  return (
    <SignInScreen
      next={sharedReturnPathFromQuery(nextValues)}
      {...(initialMessage === undefined ? {} : { initialMessage })}
    />
  );
}
