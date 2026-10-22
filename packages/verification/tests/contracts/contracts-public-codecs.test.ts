import test from "node:test";
import { MAX_CHAT_CONTEXT_MESSAGES } from "@recall/ai-core";
import {
  assert,
  Contracts,
  TutorApiRequestSchema,
  TutorApiResponseSchema,
  TutorSessionStateResponseSchema,
  ResolveTutorProposalRequestSchema,
  ResolveTutorProposalResponseSchema,
  first,
  second,
  token,
  timestamp,
  impossibleTimestamp,
  card,
  document,
  version,
  review,
  publicQuestion,
  context,
  accountExport,
  valid,
  codec,
} from "./contracts-test-support.js";

void test("public codecs remove credential and learner-state fields", () => {
  const auth = valid(Contracts.AuthSessionResponseSchema, {
    schemaVersion: 1,
    authenticated: true,
    displayLabel: "Learner",
    ownerId: first,
    accessToken: "private",
    providerSubject: "private",
  });
  assert.deepEqual(
    Object.keys(auth).sort(),
    ["schemaVersion", "authenticated", "displayLabel", "ownerId"].sort(),
  );
  const response = valid(Contracts.ReadPublishedKnowledgeAreaResponseSchema, {
    version: {
      ...version,
      ownerId: first,
      shareToken: token,
      reviewEvents: [review],
      content: {
        ...document,
        reviewEvents: [review],
        cards: [{ ...card, schedule: { due: timestamp }, learnerAnswer: "private" }],
      },
    },
  });
  assert.equal("ownerId" in response.version, false);
  assert.equal("shareToken" in response.version, false);
  assert.equal("reviewEvents" in response.version, false);
  assert.equal("reviewEvents" in response.version.content, false);
  const publicCard = response.version.content.cards[0];
  assert.ok(publicCard);
  assert.equal("schedule" in publicCard, false);
  assert.equal("learnerAnswer" in publicCard, false);
});
codec(
  "public authentication status preserves signed-out privacy and bounds labels",
  Contracts.AuthSessionResponseSchema,
  [{ schemaVersion: 1, authenticated: false, displayLabel: null, ownerId: null }],
  [
    { schemaVersion: 1, authenticated: false, displayLabel: "private", ownerId: first },
    { schemaVersion: 1, authenticated: true, displayLabel: "", ownerId: first },
    { schemaVersion: 1, authenticated: true, displayLabel: "x".repeat(321), ownerId: first },
    { schemaVersion: 2, authenticated: false, displayLabel: null, ownerId: null },
  ],
);
codec(
  "private account export has exact version and UTC calendar timestamps",
  Contracts.AccountExportResponseSchema,
  [accountExport],
  [
    { ...accountExport, version: 2 },
    { ...accountExport, exportedAt: impossibleTimestamp },
    { ...accountExport, exportedAt: "2026-10-03T12:30:00+00:00" },
    { ...accountExport, data: {} },
  ],
);
codec(
  "account deletion requires explicit confirmation and literal success",
  Contracts.DeleteAccountRequestSchema,
  [{ confirmation: "DELETE" }],
  [{}, { confirmation: "delete" }, { confirmation: true }],
);
codec(
  "deletion acknowledgment cannot claim partial failure as success",
  Contracts.DeleteAccountResponseSchema,
  [{ deleted: true }],
  [{ deleted: false }, { deleted: "true" }, {}],
);
codec(
  "tutor privacy policies bound retention independently of content",
  Contracts.TutorPrivacyPolicySchema,
  [
    { schemaVersion: 1, retentionDays: null, deletionAvailable: true },
    { schemaVersion: 1, retentionDays: 365, deletionAvailable: true },
  ],
  [
    { schemaVersion: 2, retentionDays: 30, deletionAvailable: true },
    { schemaVersion: 1, retentionDays: 0, deletionAvailable: true },
    { schemaVersion: 1, retentionDays: 366, deletionAvailable: true },
  ],
);
codec(
  "tutor deletion requires its own explicit confirmation",
  Contracts.DeleteTutorHistoryRequestSchema,
  [{ confirmation: "DELETE_TUTOR_HISTORY" }],
  [{ confirmation: "DELETE" }, {}],
);
codec(
  "tutor deletion counts and bounded retention batches validate acknowledgments",
  Contracts.DeleteTutorHistoryResponseSchema,
  [{ schemaVersion: 1, deleted: true, deletedSessions: 0 }],
  [
    { schemaVersion: 1, deleted: false, deletedSessions: 0 },
    { schemaVersion: 1, deleted: true, deletedSessions: -1 },
  ],
);
codec(
  "retention result bounds server batch count",
  Contracts.TutorRetentionResponseSchema,
  [{ schemaVersion: 1, deletedSessions: 1000 }],
  [
    { schemaVersion: 1, deletedSessions: 1001 },
    { schemaVersion: 2, deletedSessions: 0 },
  ],
);
const telemetry = {
  schemaVersion: 1,
  requestId: first,
  operation: "tutor-action",
  status: 200,
  durationMs: 12,
  timestamp,
  unexpectedFailure: false,
};
codec(
  "sanitized operational telemetry validates operation/status/calendar boundaries",
  Contracts.HttpTelemetryEventSchema,
  [telemetry],
  [
    { ...telemetry, status: 600 },
    { ...telemetry, durationMs: -1 },
    { ...telemetry, operation: "other" },
    { ...telemetry, timestamp: impossibleTimestamp },
  ],
);

codec(
  "tutor request/response envelopes require supported schema versions",
  TutorApiRequestSchema,
  [{ schemaVersion: 1, request: { action: "question", context } }],
  [
    { schemaVersion: 2, request: { action: "question", context } },
    { schemaVersion: 1, request: { action: "evaluate", sessionId: first, answer: "" } },
  ],
);
codec(
  "tutor response envelopes validate result action and session identity",
  TutorApiResponseSchema,
  [{ schemaVersion: 1, response: publicQuestion }],
  [
    { schemaVersion: 2, response: publicQuestion },
    { schemaVersion: 1, response: { ...publicQuestion, sessionId: "bad" } },
  ],
);
codec(
  "tutor state response accepts complete chat history within the transport bound",
  TutorSessionStateResponseSchema,
  [
    {
      schemaVersion: 1,
      state: {
        sessionId: first,
        history: Array.from({ length: MAX_CHAT_CONTEXT_MESSAGES }, (_, index) => ({
          role: index % 2 === 0 ? "assistant" : "learner",
          content: `Message ${String(index)}`,
        })),
        evaluation: null,
        proposal: null,
        quiz: null,
      },
    },
  ],
  [
    {
      schemaVersion: 1,
      state: {
        sessionId: first,
        history: Array.from({ length: MAX_CHAT_CONTEXT_MESSAGES + 1 }, () => ({
          role: "assistant",
          content: "q",
        })),
        evaluation: null,
        proposal: null,
        quiz: null,
      },
    },
  ],
);
codec(
  "proposal resolution intent and acknowledgment accept only approval/rejection states",
  ResolveTutorProposalRequestSchema,
  [
    { schemaVersion: 1, request: { proposalId: first, state: "approved", cardId: second } },
    { schemaVersion: 1, request: { proposalId: first, state: "rejected" } },
  ],
  [
    { schemaVersion: 1, request: { proposalId: first, state: "pending" } },
    { schemaVersion: 2, request: { proposalId: first, state: "rejected" } },
  ],
);
codec(
  "proposal response cannot acknowledge an unrecognized state",
  ResolveTutorProposalResponseSchema,
  [{ schemaVersion: 1, proposalId: first, state: "approved" }],
  [
    { schemaVersion: 1, proposalId: first, state: "pending" },
    { schemaVersion: 1, proposalId: "bad", state: "rejected" },
  ],
);
