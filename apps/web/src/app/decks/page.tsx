import Link from "next/link";
import type { Route } from "next";
import { DeckLandingClient } from "@/components/publishing/DeckLandingClient";

export default function DeckDiscoveryPage() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 px-4 py-8 sm:px-8">
      <Link className="text-sm text-muted-foreground hover:text-foreground" href={"/" as Route}>
        ← Workspace
      </Link>
      <DeckLandingClient />
    </main>
  );
}
