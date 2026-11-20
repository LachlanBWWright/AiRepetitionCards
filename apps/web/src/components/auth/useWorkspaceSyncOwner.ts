"use client";
import { useEffect } from "react";
import { Effect, Either, Fiber, Schema } from "effect";
import { AccountIdSchema } from "@recall/domain";
import { readBrowserSession } from "@/lib/auth/browser-session";
export function useWorkspaceSyncOwner(demo: boolean, publishOwner: (owner: string | null) => void) {
  useEffect(() => {
    if (demo) return;
    const desktop = window.recallDesktop;
    if (desktop) {
      let mounted = true;
      let changed = false;
      const publish = (input: unknown) => {
        if (typeof input !== "object" || input === null || !("value" in input)) return;
        const decoded = Schema.decodeUnknownEither(
          Schema.Struct({ configured: Schema.Boolean, ownerId: Schema.NullOr(AccountIdSchema) }),
        )(input.value);
        if (Either.isRight(decoded) && mounted) publishOwner(decoded.right.ownerId);
      };
      void Effect.runPromise(
        Effect.either(
          Effect.tryPromise({
            try: () => desktop.auth.getStatus(),
            catch: () => ({ _tag: "SyncAuthLookupError" }) as const,
          }),
        ),
      ).then((result) => {
        if (Either.isRight(result) && !changed) publish(result.right);
      });
      const unsubscribe = desktop.auth.onStateChanged((input) => {
        changed = true;
        const decoded = Schema.decodeUnknownEither(
          Schema.Struct({ ownerId: Schema.NullOr(AccountIdSchema) }),
        )(input);
        if (Either.isRight(decoded) && mounted) publishOwner(decoded.right.ownerId);
      });
      return () => {
        mounted = false;
        unsubscribe();
      };
    }
    let mounted = true;
    const isMounted = () => mounted;
    let lookupGeneration = 0;
    const refresh = () => {
      const generation = ++lookupGeneration;
      return Effect.runFork(
        readBrowserSession().pipe(
          Effect.tap((session) =>
            Effect.sync(() => {
              if (isMounted() && generation === lookupGeneration) publishOwner(session.ownerId);
            }),
          ),
          Effect.ignore,
        ),
      );
    };
    const fiber = refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, [demo, publishOwner]);
}
