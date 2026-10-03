import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { supabaseApiAuthFailureStatus } from "@recall/infra-supabase";
import { observeRoute } from "@/lib/http/observe-route";
import { NextResponse } from "next/server";
import { privateJson } from "@/lib/http/private-json";
import { Effect, Either, Schema } from "effect";
import { AccountExportResponseSchema } from "@recall/contracts";
import { readAccountExportRows } from "@recall/infra-supabase/account-export";
import { authenticateApiRequest } from "@/lib/supabase/api-auth";

async function handleGET(request: Request): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request);
  if (auth._tag === "ContextError") {
    const status = supabaseApiAuthFailureStatus(auth.reason);
    return privateJson({ error: auth.reason }, { status });
  }

  const limited = await authenticatedApiRateLimit(auth.userId, "workspace-sync", {
    request,
    namespace: "account",
  });
  if (limited) return limited;
  const { client, userId } = auth;
  const result = await Effect.runPromise(Effect.either(readAccountExportRows(client, userId)));
  if (Either.isLeft(result))
    return privateJson({ error: "account-export-unavailable" }, { status: 502 });
  const exportRows = Schema.decodeUnknownEither(
    Schema.Struct({ profile: Schema.Unknown, data: Schema.Unknown }),
  )(result.right);
  if (Either.isLeft(exportRows))
    return privateJson({ error: "account-export-unavailable" }, { status: 502 });

  const date = new Date().toISOString().slice(0, 10);
  const exportData = {
    format: "recall-account-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    account: { userId, profile: exportRows.right.profile },
    data: exportRows.right.data,
  };
  const response = Schema.decodeUnknownEither(AccountExportResponseSchema)(exportData);
  if (Either.isLeft(response))
    return privateJson({ error: "account-export-unavailable" }, { status: 502 });

  return new NextResponse(JSON.stringify(response.right), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="recall-account-export-${date}.json"`,
      "cache-control": "private, no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}

export const GET = observeRoute("account-export", handleGET);
