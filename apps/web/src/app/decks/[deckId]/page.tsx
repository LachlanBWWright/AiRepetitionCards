import Link from "next/link";
import { Either, Schema } from "effect";
import { DeckIdSchema } from "@recall/contracts";
import { DeckLandingClient } from "@/components/publishing/sharing/DeckLandingClient";

export default async function DeckLandingPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly deckId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const decoded = Schema.decodeUnknownEither(DeckIdSchema)(route.deckId);
  if (Either.isLeft(decoded)) {
    return (
      <main className="mx-auto mt-12 w-full max-w-4xl space-y-4 rounded-xl border bg-card p-6">
        <h1 className="text-2xl font-semibold">Invalid deck link</h1>
        <p className="text-sm text-muted-foreground">Ask the sender for a complete deck link.</p>
        <Link href={"/decks"}>Browse decks</Link>
      </main>
    );
  }
  const tokenValue = query.token;
  const token = typeof tokenValue === "string" && tokenValue.length <= 512 ? tokenValue : undefined;
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 px-4 py-8 sm:px-8">
      <Link className="text-sm text-muted-foreground hover:text-foreground" href={"/decks"}>
        ← Discover decks
      </Link>
      <DeckLandingClient deckId={decoded.right} {...(token ? { token } : {})} />
    </main>
  );
}
