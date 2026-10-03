import assert from "node:assert/strict";
import test from "node:test";
import { Effect, Either, Schema } from "effect";
import { checkApiRateLimit } from "@recall/application";
import {
  createConfiguredApiRateLimitStore,
  createRedisApiRateLimitStore,
} from "../../../apps/web/src/lib/http/rate-limit-redis";
import { trustedClientIpSubject } from "../../../apps/web/src/lib/http/trusted-client-ip";

const configuration = {
  url: "https://redis.fixture.invalid",
  token: "fixture-rate-token",
  prefix: "fixture:rate",
};
const input = { subject: "private-account", scope: "tutor-write", now: 1234 };
const commandSchema = Schema.Tuple(
  Schema.Literal("EVAL"),
  Schema.String,
  Schema.Literal(1),
  Schema.String,
  Schema.Number,
  Schema.Number,
);

async function withEnvironment(
  values: Readonly<Record<string, string | undefined>>,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = value;
  }
  try {
    await operation();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) Reflect.deleteProperty(process.env, key);
      else process.env[key] = value;
    }
  }
}

async function withFetch(
  implementation: typeof fetch,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = globalThis.fetch;
  globalThis.fetch = implementation;
  try {
    await operation();
  } finally {
    globalThis.fetch = previous;
  }
}

void test("Redis adapter sends bounded authenticated EVAL with private stable scoped keys", async () => {
  const keys: string[] = [];
  const mock: typeof fetch = (url, init) => {
    assert.ok(typeof url === "string");
    assert.equal(url, configuration.url + "/");
    assert.equal(init?.method, "POST");
    assert.equal(init.redirect, "error");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-rate-token");
    assert.ok(typeof init.body === "string");
    const parsed = Schema.decodeUnknownEither(commandSchema)(JSON.parse(init.body) as unknown);
    assert.ok(Either.isRight(parsed));
    const [, script, , key, width, limit] = parsed.right;
    assert.ok(script.includes("redis.call('TIME')"));
    assert.ok(script.includes("redis.call('PEXPIRE'"));
    assert.equal(width, 60_000);
    assert.equal(limit, 20);
    assert.match(key, /^fixture:rate:v1:[a-f0-9]{64}$/);
    assert.equal(key.includes(input.subject), false);
    keys.push(key);
    return Promise.resolve(Response.json({ result: [1, 19, 30] }));
  };
  await withFetch(mock, async () => {
    const store = createRedisApiRateLimitStore(configuration);
    for (const subject of [input.subject, input.subject, "another-account"]) {
      const result = await Effect.runPromise(
        Effect.either(checkApiRateLimit({ ...input, subject }, store)),
      );
      assert.ok(Either.isRight(result));
      assert.deepEqual(result.right, { allowed: true, remaining: 19, retryAfterSeconds: 30 });
    }
  });
  assert.equal(keys[0], keys[1]);
  assert.notEqual(keys[0], keys[2]);
});

void test("Redis denies at the cap and rejects malformed or contradictory decisions", async () => {
  for (const reply of [
    { result: [0, 0, 60] },
    { result: [0, 1, 60] },
    { result: [1, 20, 60] },
    { result: [1, 19, 61] },
    { result: [1, 19, 1.5] },
    { result: [true, 19, 60] },
    { result: [-1, 0, 60] },
    { error: "fixture vendor failure" },
  ]) {
    await withFetch(
      () => Promise.resolve(Response.json(reply)),
      async () => {
        const result = await Effect.runPromise(
          Effect.either(checkApiRateLimit(input, createRedisApiRateLimitStore(configuration))),
        );
        if (reply.result?.[0] === 0 && reply.result[1] === 0) {
          assert.ok(Either.isRight(result));
          assert.equal(result.right.allowed, false);
        } else {
          assert.ok(Either.isLeft(result));
          assert.equal(result.left._tag, "ApiRateLimitUnavailable");
        }
      },
    );
  }
});

void test("Redis bounds streamed response bodies and classifies HTTP and transport failures", async () => {
  let cancelled = false;
  const responses: Array<() => Response> = [
    () => new Response("fixture failure", { status: 503 }),
    () => new Response("not JSON"),
    () => new Response(new Uint8Array([0xff])),
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(4097));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  ];
  for (const response of responses) {
    await withFetch(
      () => Promise.resolve(response()),
      async () => {
        const result = await Effect.runPromise(
          Effect.either(checkApiRateLimit(input, createRedisApiRateLimitStore(configuration))),
        );
        assert.ok(Either.isLeft(result));
        assert.equal(result.left.reason, "store-unavailable");
      },
    );
  }
  assert.equal(cancelled, true);
  await withFetch(
    () => Promise.reject(new Error("fixture transport rejected")),
    async () => {
      const result = await Effect.runPromise(
        Effect.either(checkApiRateLimit(input, createRedisApiRateLimitStore(configuration))),
      );
      assert.ok(Either.isLeft(result));
      assert.equal(result.left.reason, "store-unavailable");
    },
  );
});

void test("Production Redis configuration fails closed without network or memory fallback", async () => {
  let calls = 0;
  await withFetch(
    () => {
      calls += 1;
      return Promise.resolve(Response.json({ result: [1, 19, 60] }));
    },
    async () => {
      await withEnvironment(
        {
          NODE_ENV: "production",
          API_RATE_LIMIT_MODE: undefined,
          API_RATE_LIMIT_STORE_REST_URL: undefined,
          API_RATE_LIMIT_STORE_REST_TOKEN: undefined,
        },
        async () => {
          const result = await Effect.runPromise(
            Effect.either(checkApiRateLimit(input, createConfiguredApiRateLimitStore())),
          );
          assert.ok(Either.isLeft(result));
        },
      );
      for (const invalid of [
        { ...configuration, url: "http://redis.fixture.invalid" },
        { ...configuration, url: "https://user:secret@redis.fixture.invalid" },
        { ...configuration, url: "https://redis.fixture.invalid?secret=value" },
        { ...configuration, token: "" },
        { ...configuration, prefix: "invalid prefix" },
      ]) {
        const result = await Effect.runPromise(
          Effect.either(checkApiRateLimit(input, createRedisApiRateLimitStore(invalid))),
        );
        assert.ok(Either.isLeft(result));
      }
    },
  );
  assert.equal(calls, 0);
});

void test("Trusted IP buckets canonicalize IPv6 and mapped IPv4 before keyed hashing", async () => {
  await withEnvironment(
    {
      API_RATE_LIMIT_TRUSTED_IP_HEADER: "x-fixture-client-ip",
      API_RATE_LIMIT_IP_HMAC_SECRET: "fixture-ip-secret-that-is-at-least-32-characters",
    },
    async () => {
      const subject = async (address: string) => {
        const result = await Effect.runPromise(
          Effect.either(
            trustedClientIpSubject(
              new Request("https://recall.fixture.invalid", {
                headers: { "x-fixture-client-ip": address },
              }),
            ),
          ),
        );
        assert.ok(Either.isRight(result));
        assert.equal(typeof result.right, "string");
        return result.right;
      };
      assert.equal(await subject("2001:db8::1"), await subject("2001:0DB8:0:0:0:0:0:1"));
      const ipv4 = await subject("192.0.2.1");
      assert.equal(ipv4, await subject("::ffff:192.0.2.1"));
      assert.equal(ipv4, await subject("0:0:0:0:0:ffff:c000:201"));
      assert.notEqual(ipv4, await subject("192.0.2.2"));
      assert.match(String(ipv4), /^[a-f0-9]{64}$/);
    },
  );
});

void test("Trusted IP configuration rejects missing, malformed and forwarded-chain identities", async () => {
  const header = "x-fixture-client-ip";
  const secret = "fixture-ip-secret-that-is-at-least-32-characters";
  await withEnvironment(
    { API_RATE_LIMIT_TRUSTED_IP_HEADER: header, API_RATE_LIMIT_IP_HMAC_SECRET: secret },
    async () => {
      for (const address of [
        undefined,
        "",
        "192.0.2.1, 192.0.2.2",
        "192.0.2.1:8080",
        "[::1]",
        "fe80::1%eth0",
        "999.0.2.1",
      ]) {
        const request = new Request("https://recall.fixture.invalid", {
          headers: address === undefined ? {} : { [header]: address },
        });
        const result = await Effect.runPromise(Effect.either(trustedClientIpSubject(request)));
        assert.ok(Either.isLeft(result));
        assert.equal(result.left.reason, "header");
      }
      const absent = await Effect.runPromise(Effect.either(trustedClientIpSubject()));
      assert.ok(Either.isLeft(absent));
      assert.equal(absent.left.reason, "request");
    },
  );
  await withEnvironment(
    { API_RATE_LIMIT_TRUSTED_IP_HEADER: " ", API_RATE_LIMIT_IP_HMAC_SECRET: " " },
    async () => {
      assert.equal(await Effect.runPromise(trustedClientIpSubject()), null);
    },
  );
  await withEnvironment(
    { API_RATE_LIMIT_TRUSTED_IP_HEADER: header, API_RATE_LIMIT_IP_HMAC_SECRET: "" },
    async () => {
      const result = await Effect.runPromise(Effect.either(trustedClientIpSubject()));
      assert.ok(Either.isLeft(result));
      assert.equal(result.left.reason, "configuration");
    },
  );
});
