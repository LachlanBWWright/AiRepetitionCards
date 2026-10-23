import { Button } from "@/components/ui/Button";

export type OAuthProvider = "apple" | "google";

export function OAuthSignInButtons({
  providers,
  busy,
  onSelect,
}: {
  readonly providers: readonly OAuthProvider[];
  readonly busy: boolean;
  readonly onSelect: (provider: OAuthProvider) => void;
}) {
  if (providers.length === 0) return null;
  return (
    <div className="grid gap-3 pt-2">
      {providers.map((provider) => (
        <Button
          key={provider}
          type="button"
          disabled={busy}
          variant={provider === "apple" ? "default" : "secondary"}
          onClick={() => {
            onSelect(provider);
          }}
        >
          Continue with {provider === "apple" ? "Apple" : "Google"}
        </Button>
      ))}
    </div>
  );
}
