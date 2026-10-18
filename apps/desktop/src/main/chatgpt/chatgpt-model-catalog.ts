import { fail, type Reply } from "./transport/chatgpt-local-protocol";
type Model = { readonly slug: string; readonly displayName: string };
/** Prevent catalog refreshes from delaying sign-out or running after an account change. */
export function createChatGptModelCatalog(dependencies: {
  readonly generation: () => number;
  readonly serialize: <T>(operation: () => Promise<Reply<T>>) => Promise<Reply<T>>;
  readonly models: (signal: AbortSignal) => Promise<Reply<readonly Model[]>>;
}) {
  let current: AbortController | null = null;
  return {
    cancel: () => {
      current?.abort();
    },
    read: () => {
      const generation = dependencies.generation();
      return dependencies.serialize(async () => {
        if (generation !== dependencies.generation()) return fail("inference-cancelled");
        const controller = new AbortController();
        current = controller;
        try {
          return await dependencies.models(controller.signal);
        } finally {
          if (current === controller) current = null;
        }
      });
    },
  };
}
