import { Effect, Either, Schema } from "effect";
import { createTutorPrivacyApi, type TutorPrivacyFailure } from "@recall/application";
import "./desktop-api";
import { localWritesBlocked } from "@/features/workspace/local-write-coordinator";
import { volatileStorage } from "@/lib/volatile-storage";

const StatusReply = Schema.Struct({
  _tag: Schema.Literal("Success"),
  value: Schema.Struct({
    enabled: Schema.Boolean,
    activeClientId: Schema.NullOr(Schema.String),
  }),
});
const unavailable = (): TutorPrivacyFailure => ({
  _tag: "TutorPrivacyFailure",
  reason: "transport",
});

/** Profile-owned local transcripts; authentication credentials and learning content are separate. */
export function createLocalTutorPrivacyApi(profile: string) {
  const prefixes = [
    `recall-chatgpt-tutor:${profile}:`,
    `recall-chatgpt-proposal-session:${profile}:`,
  ];
  const verifyProfile = () =>
    Effect.gen(function* () {
      const bridge = window.recallDesktop?.chatgpt;
      if (!bridge || !profile) return yield* Effect.fail(unavailable());
      const raw = yield* Effect.tryPromise({ try: bridge.status, catch: unavailable });
      const decoded = Schema.decodeUnknownEither(StatusReply)(raw);
      if (
        Either.isLeft(decoded) ||
        !decoded.right.value.enabled ||
        decoded.right.value.activeClientId !== profile
      )
        return yield* Effect.fail(unavailable());
    });
  return createTutorPrivacyApi((request) =>
    Effect.gen(function* () {
      yield* verifyProfile();
      if (request.method === "GET") {
        return {
          status: 200,
          body: { schemaVersion: 1, retentionDays: null, deletionAvailable: true },
        };
      }
      const snapshot = yield* Effect.try({
        try: () => {
          const entries: { readonly key: string; readonly value: string }[] = [];
          for (let index = 0; index < volatileStorage.length; index += 1) {
            const key = volatileStorage.key(index);
            if (key && prefixes.some((prefix) => key.startsWith(prefix))) {
              const value = volatileStorage.getItem(key);
              if (value !== null) entries.push({ key, value });
            }
          }
          return entries;
        },
        catch: unavailable,
      });
      yield* Effect.forEach(snapshot, ({ key }) =>
        Effect.try({ try: () => volatileStorage.removeItem(key), catch: unavailable }),
      ).pipe(
        Effect.catchAll((error) =>
          Effect.forEach(snapshot, ({ key, value }) =>
            Effect.suspend(() =>
              localWritesBlocked()
                ? Effect.fail(unavailable())
                : Effect.try({
                    try: () => volatileStorage.setItem(key, value),
                    catch: unavailable,
                  }),
            ).pipe(Effect.ignore),
          ).pipe(Effect.andThen(Effect.fail(error))),
        ),
      );
      return {
        status: 200,
        body: {
          schemaVersion: 1,
          deleted: true,
          deletedSessions: snapshot.filter(({ key }) => key.startsWith(prefixes[0] ?? "")).length,
        },
      };
    }),
  );
}
