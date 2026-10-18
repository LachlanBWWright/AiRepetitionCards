import {
  CardProposalSchema,
  ResolveTutorProposalRequestSchema,
  ResolveTutorProposalResponseSchema,
} from "@recall/ai-core";
import { validateTutorProposalResolution, type TutorWorkflowFailure } from "@recall/application";
import { createTutorApprovalAdmin } from "@/lib/supabase/tutor-approval-admin";
import { authenticatedApiRateLimit } from "@/lib/http/api-rate-limit";
import { privateJson } from "@/lib/http/private-json";
import { readJsonBody } from "@/lib/http/read-json";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { readTutorProposal } from "@recall/infra-supabase/tutor-repository";
import {
  linkExistingTutorApprovalRevision,
  resolveTutorProposal,
} from "@recall/infra-supabase/tutor-writes";
import { toDatabaseJson } from "@recall/infra-supabase/json";
import type { Json } from "@recall/infra-supabase/database.types";
import { Effect, Either, Schema } from "effect";
import { NextResponse, type NextRequest } from "next/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
type AuthResult =
  | {
      readonly _tag: "Authenticated";
      readonly client: SupabaseServerClient;
      readonly userId: string;
    }
  | { readonly _tag: "AuthFailure"; readonly status: 401 | 502 | 503 };

type RequireUser = () => Promise<AuthResult>;
type WorkflowFailureResponder = (error: TutorWorkflowFailure) => NextResponse;

function unavailable(): NextResponse {
  return privateJson({ error: "tutor-storage-unavailable" }, { status: 502 });
}

function sameProposalContent(left: unknown, right: typeof CardProposalSchema.Type): boolean {
  const decoded = Schema.decodeUnknownEither(CardProposalSchema)(left);
  return (
    Either.isRight(decoded) &&
    decoded.right.front === right.front &&
    decoded.right.back === right.back &&
    decoded.right.objectiveId === right.objectiveId &&
    decoded.right.rationale === right.rationale
  );
}

export async function handleTutorProposalPatch(
  request: NextRequest,
  requireUser: RequireUser,
  workflowFailureResponse: WorkflowFailureResponder,
): Promise<NextResponse> {
  const auth = await requireUser();
  if (auth._tag === "AuthFailure") {
    return privateJson(
      { error: auth.status === 401 ? "unauthenticated" : "auth-unavailable" },
      { status: auth.status },
    );
  }
  const limited = await authenticatedApiRateLimit(auth.userId, "tutor-write", { request });
  if (limited) return limited;
  const body = await Effect.runPromise(Effect.either(readJsonBody(request, 64_000)));
  if (Either.isLeft(body)) {
    return privateJson(
      { error: body.left.reason === "too-large" ? "request-too-large" : "invalid-request" },
      { status: body.left.reason === "too-large" ? 413 : 400 },
    );
  }
  const apiRequest = Schema.decodeUnknownEither(ResolveTutorProposalRequestSchema)(body.right);
  if (Either.isLeft(apiRequest)) return privateJson({ error: "invalid-request" }, { status: 400 });
  const decoded = await Effect.runPromise(
    Effect.either(validateTutorProposalResolution(apiRequest.right.request)),
  );
  if (Either.isLeft(decoded)) return workflowFailureResponse(decoded.left);
  let approvedCardId: string | undefined;
  let approvedContent: Exclude<Json, null> | undefined;
  if (decoded.right.state === "approved") {
    if (!decoded.right.cardId) return privateJson({ error: "invalid-request" }, { status: 400 });
    approvedCardId = decoded.right.cardId;
    if (decoded.right.content) {
      const encodedContent = await Effect.runPromise(
        Effect.either(toDatabaseJson(decoded.right.content)),
      );
      if (Either.isLeft(encodedContent) || encodedContent.right === null) return unavailable();
      approvedContent = encodedContent.right;
    }
  }
  const result = await Effect.runPromise(
    Effect.either(
      resolveTutorProposal(
        auth.client,
        decoded.right.proposalId,
        decoded.right.state,
        approvedContent,
        approvedCardId,
      ),
    ),
  );
  if (Either.isLeft(result)) return unavailable();
  if (!result.right) {
    const persisted = await Effect.runPromise(
      Effect.either(readTutorProposal(auth.client, auth.userId, decoded.right.proposalId)),
    );
    if (Either.isLeft(persisted)) {
      if (persisted.left._tag !== "TutorReadNotFound") return unavailable();
      return privateJson({ error: "proposal-not-pending" }, { status: 409 });
    }
    const stateMatches = persisted.right.state === decoded.right.state;
    const approvalMatches =
      decoded.right.state !== "approved" ||
      (persisted.right.approved_card_id === decoded.right.cardId &&
        (decoded.right.content === undefined ||
          sameProposalContent(persisted.right.content, decoded.right.content)));
    if (!stateMatches || !approvalMatches)
      return privateJson({ error: "proposal-not-pending" }, { status: 409 });
  }
  if (decoded.right.state === "approved") {
    const linked = await Effect.runPromise(
      Effect.either(
        linkExistingTutorApprovalRevision(
          auth.client,
          createTutorApprovalAdmin(),
          auth.userId,
          decoded.right.proposalId,
        ),
      ),
    );
    if (Either.isLeft(linked)) return unavailable();
  }
  const response = Schema.decodeUnknownEither(ResolveTutorProposalResponseSchema)({
    schemaVersion: 1,
    proposalId: decoded.right.proposalId,
    state: decoded.right.state,
  });
  return Either.isLeft(response)
    ? privateJson({ error: "proposal-response-invalid" }, { status: 502 })
    : privateJson(response.right);
}
