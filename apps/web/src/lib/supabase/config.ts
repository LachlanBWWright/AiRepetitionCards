import { Either } from "effect";

export type SupabaseConfigError = {
  readonly _tag: "SupabaseConfigError";
  readonly reason: "missing-environment" | "invalid-url";
};

export type SupabaseConfig = {
  readonly url: string;
  readonly publishableKey: string;
};

export function readSupabaseConfig(): Either.Either<SupabaseConfig, SupabaseConfigError> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) {
    return Either.left({ _tag: "SupabaseConfigError", reason: "missing-environment" });
  }
  if (!/^https?:\/\/[^\s/]+(?:\/[^\s]*)?$/.test(url)) {
    return Either.left({ _tag: "SupabaseConfigError", reason: "invalid-url" });
  }
  return Either.right({ url, publishableKey });
}
