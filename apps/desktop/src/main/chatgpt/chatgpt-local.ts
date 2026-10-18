import { countLocalChatGPTContext } from "./transport/chatgpt-context-count";
import { readChatGPTModels } from "./chatgpt-local-models";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { app, ipcMain, safeStorage, shell } from "electron";
import type { IpcMainInvokeEvent } from "electron";
import { reserveLocalAiUsage, settleLocalAiUsage } from "@recall/application";
import {
  completedChatGPTText,
  type TutorInferenceReply,
  readChatGPTTokenUsage,
  readChatGPTUsageCounts,
  readChatGPTStream,
  chatGPTTransportFailureCode,
  chatGPTTutorBody,
} from "./transport/chatgpt-inference";
import { desktopSecureStorageAvailable } from "../security/desktop-secure-storage";
import { createChatGptLocalAccounts } from "./auth/chatgpt-local-accounts";
import { createChatGptLocalUsageAccess } from "./usage/chatgpt-local-usage-access";
import { createLocalAiUsageStore } from "./usage/local-ai-usage";
import { performChatGptLocalSignIn } from "./auth/chatgpt-local-sign-in";
import { researchBody } from "./research/chatgpt-research-request";
import { createChatGptModelCatalog } from "./chatgpt-model-catalog";
import { signOutLocalChatGpt } from "./auth/chatgpt-local-sign-out";
import {
  parseChatGPTResearchResult,
  type ChatGPTResearchResult,
} from "./research/chatgpt-research-result";
import { Effect, Either, Schema } from "effect";
import {
  text,
  Request,
  ResearchRequest,
  ResearchSourceRequest,
  IdInput,
  type LocalStore,
  type Reply,
  fail,
  resource,
  object,
  inferenceAborted,
  responseFailure,
  jsonResponse,
} from "./transport/chatgpt-local-protocol";
export function registerChatGptLocal(trustedSender: (event: IpcMainInvokeEvent) => boolean): void {
  const credentialPath = join(app.getPath("userData"), "chatgpt-local", "credentials.enc");
  const localUsage = createLocalAiUsageStore(
    join(app.getPath("userData"), "chatgpt-local", "usage.json"),
  );
  let store: LocalStore | null = null;
  let busy = false;
  let inferenceGeneration = 0;
  let researchSources: {
    readonly clientId: string;
    readonly generation: number;
    readonly urls: ReadonlySet<string>;
  } | null = null;
  let inferenceController: AbortController | null = null;
  const usagePaused = new Set<string>();
  let pendingSignIn = false;
  let queue: Promise<unknown> = Promise.resolve();
  const protect = async <T>(operation: () => Promise<Reply<T>>): Promise<Reply<T>> => {
    const result = await Effect.runPromise(
      Effect.either(
        Effect.tryPromise({
          try: operation,
          catch: (error) => fail(chatGPTTransportFailureCode(error)),
        }),
      ),
    );
    return Either.isRight(result) ? result.right : result.left;
  };
  const usageOperation = async <T, E>(operation: Effect.Effect<T, E>): Promise<Reply<T>> => {
    const result = await Effect.runPromise(Effect.either(operation));
    if (Either.isRight(result)) return { _tag: "Success", value: result.right };
    const error = object(result.left);
    return fail(
      error?._tag === "LocalAiBudgetExceeded"
        ? "local-ai-budget-exceeded"
        : "local-ai-usage-unavailable",
    );
  };
  const secureAvailable = () =>
    Effect.runPromise(
      desktopSecureStorageAvailable(safeStorage, process.platform).pipe(
        Effect.orElseSucceed(() => false),
      ),
    );
  const accounts = createChatGptLocalAccounts({
    credentialPath,
    secureAvailable,
    protect,
    getStore: () => store,
    setStore: (next) => {
      store = next;
    },
    decrypt: (encrypted) => safeStorage.decryptStringAsync(encrypted),
    encrypt: (value) => safeStorage.encryptStringAsync(value),
  });
  const { load, save, update, tokenRequest, activeAccount } = accounts;
  const serialize = <T>(operation: () => Promise<Reply<T>>): Promise<Reply<T>> => {
    const result = queue.then(() => protect(operation));
    queue = result;
    return result;
  };
  async function signIn(input: typeof IdInput.Type): Promise<Reply<boolean>> {
    if (pendingSignIn) return fail("sign-in-in-progress");
    pendingSignIn = true;
    try {
      return await performChatGptLocalSignIn(input, {
        load,
        serialize,
        save,
        getStore: () => store,
        update,
        tokenRequest,
        advanceInferenceGeneration: () => {
          inferenceGeneration += 1;
        },
        cancelInference: () => inferenceController?.abort(),
      });
    } finally {
      pendingSignIn = false;
    }
  }
  async function models(
    signal?: AbortSignal,
  ): Promise<Reply<readonly { readonly slug: string; readonly displayName: string }[]>> {
    const active = await activeAccount(signal);
    if (active._tag === "Failure") return active;
    return readChatGPTModels(active.value.credentials?.accessToken ?? "", fetch, signal);
  }

  async function respond(
    input: typeof Request.Type,
    research = false,
  ): Promise<Reply<TutorInferenceReply | ChatGPTResearchResult>> {
    if (busy) return fail("inference-in-progress");
    busy = true;
    const controller = new AbortController();
    inferenceController = controller;
    const reservation: { id: string | null } = { id: null };
    let usageOutcome: "completed" | "failed" = "failed";
    let usageCounts: ReturnType<typeof readChatGPTUsageCounts> = {
      inputTokens: null,
      outputTokens: null,
    };
    let countedInputTokens = 0;
    const result = await protect<TutorInferenceReply | ChatGPTResearchResult>(async () => {
      const active = await activeAccount(controller.signal);
      if (active._tag === "Failure") return active;
      if (active.value.clientId !== input.expectedClientId) return fail("account-changed");
      if (inferenceAborted(controller.signal)) return fail("inference-cancelled");
      if (usagePaused.has(active.value.clientId))
        return fail("subscription_sharing_usage_limit_exceeded");
      const catalog = await models(controller.signal);
      if (catalog._tag === "Failure") return catalog;
      if (!catalog.value.some((model) => model.slug === input.model))
        return fail("model-unavailable");
      if (inferenceAborted(controller.signal)) return fail("inference-cancelled");
      const admissionFailure = (raw: unknown, response: Response) => {
        const failure = responseFailure(raw, response);
        if (failure.recovery === "usage-limit") usagePaused.add(active.value.clientId);
        if (
          research &&
          (failure.param?.startsWith("tools") || failure.param?.startsWith("tool_choice"))
        )
          return { ...failure, recovery: "unsupported" as const };
        return failure;
      };
      const body = research ? researchBody(input) : chatGPTTutorBody(input);
      if (!research) {
        const counted = await countLocalChatGPTContext(body, {
          request: fetch,
          resource,
          signal: controller.signal,
          accessToken: active.value.credentials?.accessToken ?? "",
        });
        if (Either.isLeft(counted)) return fail(counted.left);
        countedInputTokens = counted.right;
      }
      const requestId = randomUUID();
      const reserved = await usageOperation(
        Effect.gen(function* () {
          const state = yield* localUsage.read();
          const result = yield* reserveLocalAiUsage(state, {
            requestId,
            accountId: active.value.clientId,
            model: input.model,
            task: research ? "research" : "tutor",
            startedAt: Date.now(),
          });
          yield* localUsage.write(result.state);
          return result.entry;
        }),
      );
      if (reserved._tag === "Failure") return reserved;
      reservation.id = requestId;
      if (inferenceAborted(controller.signal)) return fail("inference-cancelled");
      const response = await fetch(`${resource}/responses`, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]),
        headers: {
          authorization: `Bearer ${active.value.credentials?.accessToken ?? ""}`,
          accept: "text/event-stream",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) return admissionFailure(await jsonResponse(response), response);
      const streamed = await Effect.runPromise(Effect.either(readChatGPTStream(response)));
      if (Either.isLeft(streamed)) {
        usageCounts = readChatGPTUsageCounts(streamed.left.response);
        if (streamed.left.code === "provider-error") {
          const terminal = object(streamed.left.response);
          return admissionFailure(
            { error: terminal?.error ?? streamed.left.providerError },
            response,
          );
        }
        return fail(streamed.left.code);
      }
      usageCounts = readChatGPTUsageCounts(streamed.right);
      if (research) {
        const result = parseChatGPTResearchResult(streamed.right, input.model);
        if (result._tag === "Success") usageOutcome = "completed";
        return result;
      }
      const text = completedChatGPTText(streamed.right);
      if (Either.isLeft(text)) return fail(text.left);
      usageOutcome = "completed";
      return {
        _tag: "Success",
        value: {
          text: text.right,
          usage: readChatGPTTokenUsage(streamed.right, input.model, countedInputTokens),
        },
      };
    });
    inferenceController = null;
    busy = false;
    if (reservation.id !== null) {
      const requestId = reservation.id;
      const settled = await usageOperation(
        Effect.gen(function* () {
          const state = yield* localUsage.read();
          const result = yield* settleLocalAiUsage(state, {
            requestId,
            finishedAt: Date.now(),
            outcome: usageOutcome,
            ...usageCounts,
          });
          yield* localUsage.write(result.state);
        }),
      );
      if (settled._tag === "Failure") return settled;
    }
    return result;
  }
  const modelCatalog = createChatGptModelCatalog({
    generation: () => inferenceGeneration,
    serialize,
    models,
  });
  ipcMain.handle("chatgpt:status", (event) => {
    if (!trustedSender(event)) return fail("untrusted-sender");
    return serialize(async () => {
      const loaded = await load();
      if (loaded._tag === "Failure") return loaded;
      return {
        _tag: "Success",
        value: {
          enabled: true,
          activeClientId: loaded.value.activeClientId,
          accounts: loaded.value.accounts.map((account) => ({
            clientId: account.clientId,
            label: account.label ?? "ChatGPT account",
            email: account.email,
            signedIn: account.credentials !== null,
            usagePaused: usagePaused.has(account.clientId),
            planEnabled: account.credentials?.scopes.includes("chatgpt.tokens.use.direct") ?? false,
          })),
        },
      };
    });
  });
  ipcMain.handle("chatgpt:sign-in", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(IdInput)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    inferenceGeneration += 1;
    inferenceController?.abort();
    modelCatalog.cancel();
    return protect(() => signIn(decoded.right));
  });
  ipcMain.handle("chatgpt:sign-out", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(text)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    inferenceGeneration += 1;
    inferenceController?.abort();
    modelCatalog.cancel();
    return serialize(() => signOutLocalChatGpt(decoded.right, { load, save, request: fetch }));
  });
  ipcMain.handle("chatgpt:models", (event) =>
    trustedSender(event) ? modelCatalog.read() : fail("untrusted-sender"),
  );
  const usageAccess = createChatGptLocalUsageAccess({ read: localUsage.read, load });
  ipcMain.handle("chatgpt:usage", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(text)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    const generation = inferenceGeneration;
    return serialize(async () => {
      const account = await usageAccess.usageAccount(decoded.right);
      if (account._tag === "Failure") return account;
      if (generation !== inferenceGeneration) return fail("account-changed");
      const result = await usageOperation(usageAccess.usageSnapshot(decoded.right));
      return generation === inferenceGeneration ? result : fail("account-changed");
    });
  });
  ipcMain.handle("chatgpt:resume-plan", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(text)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    return serialize(async () => {
      const loaded = await load();
      if (loaded._tag === "Failure") return loaded;
      if (loaded.value.activeClientId !== decoded.right) return fail("account-changed");
      usagePaused.delete(decoded.right);
      return { _tag: "Success", value: true };
    });
  });
  ipcMain.handle("chatgpt:respond", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(Request)(input);
    if (!trustedSender(event)) return fail("untrusted-sender");
    if (Either.isLeft(decoded)) return fail("invalid-inference-request");
    const generation = inferenceGeneration;
    return serialize(async () => {
      if (generation !== inferenceGeneration) return fail("inference-cancelled");
      const result = await protect(() => respond(decoded.right));
      return generation === inferenceGeneration ? result : fail("inference-cancelled");
    });
  });
  ipcMain.handle("chatgpt:research", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(ResearchRequest)(input);
    if (!trustedSender(event) || Either.isLeft(decoded) || !decoded.right.query.trim())
      return fail("invalid-request");
    const generation = inferenceGeneration;
    return serialize(async () => {
      if (generation !== inferenceGeneration) return fail("inference-cancelled");
      const result = await protect(() =>
        respond(
          {
            model: decoded.right.model,
            input: decoded.right.query,
            expectedClientId: decoded.right.expectedClientId,
          },
          true,
        ),
      );
      if (generation !== inferenceGeneration) return fail("inference-cancelled");
      if (result._tag === "Success" && "citations" in result.value) {
        researchSources = {
          clientId: decoded.right.expectedClientId,
          generation,
          urls: new Set(result.value.citations.map((citation) => citation.url)),
        };
      }
      return result;
    });
  });
  ipcMain.handle("chatgpt:open-research-source", (event, input: unknown) => {
    const decoded = Schema.decodeUnknownEither(ResearchSourceRequest)(input);
    if (!trustedSender(event) || Either.isLeft(decoded)) return fail("invalid-request");
    return serialize(async () => {
      const loaded = await load();
      if (loaded._tag === "Failure") return loaded;
      const active = loaded.value.accounts.find(
        (account) => account.clientId === loaded.value.activeClientId,
      );
      if (!active?.credentials || active.clientId !== decoded.right.expectedClientId)
        return fail("account-changed");
      if (
        !researchSources ||
        researchSources.clientId !== active.clientId ||
        researchSources.generation !== inferenceGeneration ||
        !researchSources.urls.has(decoded.right.url)
      )
        return fail("research-source-unavailable");
      return protect(async () => {
        await shell.openExternal(decoded.right.url);
        return { _tag: "Success", value: true };
      });
    });
  });
}
