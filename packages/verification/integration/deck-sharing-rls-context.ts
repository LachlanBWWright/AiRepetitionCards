import type { Effect } from "effect";
import { createDeckSharingRlsFixtures } from "./deck-sharing-rls-fixtures";
import type { Configuration, Identity, IntegrationFailure, Reply } from "./supabase-http";

export type DeckSharingFixtures = ReturnType<typeof createDeckSharingRlsFixtures>;
export type DeckSharingFixtureUser = Effect.Effect.Success<
  ReturnType<DeckSharingFixtures["makeUser"]>
>;
export type DeckSharingAreaDocument = Effect.Effect.Success<
  ReturnType<DeckSharingFixtures["areaDocument"]>
>;
export type DeckSharingRpc = (
  identity: Identity,
  name: string,
  body: unknown,
) => Effect.Effect<Reply, IntegrationFailure>;
export type DeckSharingExpectDenied = (
  effect: Effect.Effect<Reply, IntegrationFailure>,
  label: string,
) => Effect.Effect<void, IntegrationFailure>;

export type DeckSharingScenarioContext = {
  readonly config: Configuration;
  readonly admin: Identity;
  readonly anon: Identity;
  readonly owner: DeckSharingFixtureUser;
  readonly viewer: DeckSharingFixtureUser;
  readonly stranger: DeckSharingFixtureUser;
  readonly sourceAreaId: string;
  readonly sourceDocument: DeckSharingAreaDocument;
  readonly publicVersionId: string;
  readonly fixtures: DeckSharingFixtures;
  readonly rpc: DeckSharingRpc;
  readonly expectDenied: DeckSharingExpectDenied;
  readonly id: () => string;
  readonly areaIds: string[];
  readonly publicationIds: string[];
  readonly reportIds: string[];
};
