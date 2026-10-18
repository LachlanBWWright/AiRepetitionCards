import assert from "node:assert/strict";
export { assert };
import test from "node:test";
import { Effect, Either, Schema } from "effect";
export { Effect, Either, Schema };
import * as Contracts from "@recall/contracts";
export { Contracts };
import {
  TutorApiRequestSchema,
  TutorApiResponseSchema,
  TutorSessionStateResponseSchema,
  ResolveTutorProposalRequestSchema,
  ResolveTutorProposalResponseSchema,
} from "@recall/ai-core";
export {
  TutorApiRequestSchema,
  TutorApiResponseSchema,
  TutorSessionStateResponseSchema,
  ResolveTutorProposalRequestSchema,
  ResolveTutorProposalResponseSchema,
};
import {
  createPublicationFork,
  createPublishingApi,
  preparePublication,
  publicationContentHash,
} from "@recall/application";
export { createPublicationFork, createPublishingApi, preparePublication, publicationContentHash };
import { KnowledgeAreaSchema } from "@recall/domain";
export { KnowledgeAreaSchema };

export const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const third = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const hash = "a".repeat(64);
export const token = "A".repeat(43);
export const timestamp = "2026-10-03T12:30:00.000Z";
export const impossibleTimestamp = "2026-02-30T12:30:00.000Z";
export const card = {
  kind: "basic",
  id: second,
  front: "Question",
  back: "Answer",
  objectiveIds: [third],
  tags: [],
  origin: "authored",
};
export const document = {
  schemaVersion: "1.0.0",
  id: first,
  title: "Area",
  description: null,
  language: "en",
  objectives: [{ id: third, title: "Objective", description: null, prerequisiteIds: [] }],
  ai: { tutorInstructions: "", quizInstructions: null, cardGenerationInstructions: null },
  cards: [card],
  tags: [],
  licence: "CC-BY-4.0",
  attribution: null,
};
export const version = {
  id: second,
  sourceAreaId: first,
  version: 1,
  content: document,
  contentHash: publicationContentHash(valid(KnowledgeAreaSchema, document)),
  visibility: "public",
  attribution: null,
  license: "CC-BY-4.0",
  forkedFromVersionId: null,
  createdAt: timestamp,
};
export const review = {
  id: first,
  cardId: second,
  deviceSequence: 1,
  baseReviewEventId: null,
  reviewedAtDevice: timestamp,
  effectiveReviewedAt: timestamp,
  rating: "good",
  elapsedMs: null,
  schedulerFamily: "fsrs",
  schedulerVersion: "6",
  schedulerParameterSetId: null,
  previousStateHash: null,
};
export const publicQuestion = {
  action: "question",
  sessionId: first,
  result: { question: "Question", objectiveId: third, teachingIntent: "Recall" },
};
export const context = { knowledgeArea: document, history: [] };
export const media = { id: hash, mimeType: "image/png", byteLength: 42 };
export const exportData = {
  knowledgeAreas: [],
  knowledgeAreaVersions: [],
  learningObjectives: [],
  objectivePrerequisites: [],
  cards: [],
  cardRevisions: [],
  cardObjectives: [],
  reviewEvents: [],
  schedulingState: [],
  syncChanges: [],
  tutorSessions: [],
  tutorMessages: [],
  aiObservations: [],
  generatedCardProposals: [],
  aiUsage: [],
};
export const accountExport = {
  format: "recall-account-export",
  version: 1,
  exportedAt: timestamp,
  account: { userId: first, profile: null },
  data: exportData,
};

export function valid<A, I>(schema: Schema.Schema<A, I>, input: unknown): A {
  const decoded = Schema.decodeUnknownEither(schema)(input);
  assert.ok(Either.isRight(decoded), `Expected valid input: ${JSON.stringify(input)}`);
  return decoded.right;
}
export function invalid<A, I>(schema: Schema.Schema<A, I>, input: unknown) {
  assert.ok(
    Either.isLeft(Schema.decodeUnknownEither(schema)(input)),
    `Expected invalid input: ${JSON.stringify(input)}`,
  );
}
export function codec<A, I>(
  name: string,
  schema: Schema.Schema<A, I>,
  accepted: readonly unknown[],
  rejected: readonly unknown[],
) {
  void test(name, () => {
    for (const value of accepted) valid(schema, value);
    for (const value of rejected) invalid(schema, value);
  });
}
