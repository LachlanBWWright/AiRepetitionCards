import Link from "next/link";
import { Either, Schema } from "effect";
import { ReadPublishedKnowledgeAreaRequestSchema } from "@recall/contracts";
import RecallDashboard from "@/features/dashboard/RecallDashboard";

export default async function SharedKnowledgeAreaPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly versionId: string }>;
  readonly searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}) {
  const [route, query] = await Promise.all([params, searchParams]);
  const request = Schema.decodeUnknownEither(ReadPublishedKnowledgeAreaRequestSchema)({
    versionId: route.versionId,
    shareToken: query.token ?? null,
  });
  if (Either.isLeft(request)) {
    return (
      <main className="publication-panel">
        <h1>Invalid share link</h1>
        <p>Ask the sender for a complete share link.</p>
        <Link href="/">Open your workspace</Link>
      </main>
    );
  }
  return (
    <RecallDashboard
      sharedRequest={{
        versionId: request.right.versionId,
        ...(request.right.shareToken ? { token: request.right.shareToken } : {}),
      }}
    />
  );
}
