import { spawn } from "node:child_process";
import { Effect, Either, Schema } from "effect";

const Configuration = Schema.Struct({
  projectId: Schema.String.pipe(
    Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ),
  owner: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/)),
  token: Schema.String.pipe(Schema.minLength(10)),
  apiUrl: Schema.String,
  supabaseUrl: Schema.String,
  publishableKey: Schema.String.pipe(Schema.minLength(20)),
});
const Arguments = Schema.Tuple(
  Schema.Literal("check", "build"),
  Schema.Literal("preview", "production"),
  Schema.Literal("android", "ios", "all"),
);
const parameters = Schema.decodeUnknownEither(Arguments)(process.argv.slice(2));
const configuration = Schema.decodeUnknownEither(Configuration)({
  projectId: process.env.EAS_PROJECT_ID,
  owner: process.env.EXPO_ACCOUNT_OWNER,
  token: process.env.EXPO_TOKEN,
  apiUrl: process.env.EXPO_PUBLIC_RECALL_API_URL,
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  publishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
});
const endpoint = (value) => Effect.runSync(Effect.either(Effect.try(() => new URL(value))));
function configuredEndpoint(value) {
  const parsed = endpoint(value);
  return (
    Either.isRight(parsed) &&
    parsed.right.protocol === "https:" &&
    !parsed.right.username &&
    !parsed.right.password &&
    !parsed.right.search &&
    !parsed.right.hash &&
    !["localhost", "[::1]"].includes(parsed.right.hostname) &&
    !parsed.right.hostname.endsWith(".localhost") &&
    !parsed.right.hostname.startsWith("127.")
  );
}
function publicSupabaseKey(value) {
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value)) return true;
  const parts = value.split(".");
  if (parts.length !== 3 || !parts[1]) return false;
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try(() => JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))),
    ),
  );
  return (
    Either.isRight(parsed) &&
    Either.isRight(
      Schema.decodeUnknownEither(Schema.Struct({ role: Schema.Literal("anon") }))(parsed.right),
    )
  );
}
if (Either.isLeft(parameters)) {
  process.stderr.write(
    "Usage: node scripts/eas-release.mjs <check|build> <preview|production> <android|ios|all>\n",
  );
  process.exitCode = 1;
} else if (
  Either.isLeft(configuration) ||
  !configuredEndpoint(configuration.right.apiUrl) ||
  !configuredEndpoint(configuration.right.supabaseUrl) ||
  !publicSupabaseKey(configuration.right.publishableKey) ||
  /replace|placeholder|example/i.test(configuration.right.publishableKey)
) {
  process.stderr.write(
    "Mobile release is not configured. Provide real EAS_PROJECT_ID, EXPO_ACCOUNT_OWNER, EXPO_TOKEN, HTTPS EXPO_PUBLIC_RECALL_API_URL and EXPO_PUBLIC_SUPABASE_URL, and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. See docs/mobile-release.md. Values are not logged.\n",
  );
  process.exitCode = 1;
} else if (parameters.right[0] === "check") {
  process.stdout.write(
    "Mobile release configuration is present. Account access, project ownership and signing credentials still require Expo verification.\n",
  );
} else if (process.platform === "win32" && !process.env.npm_execpath) {
  process.stderr.write(
    "On Windows, invoke a release script through pnpm so the CLI can run without a command shell.\n",
  );
  process.exitCode = 1;
} else {
  const pnpmCli = process.env.npm_execpath;
  const outcome = await Effect.runPromise(
    Effect.either(
      Effect.tryPromise({
        try: () =>
          new Promise((resolve) => {
            const child = spawn(
              pnpmCli ? process.execPath : "pnpm",
              [
                ...(pnpmCli ? [pnpmCli] : []),
                "dlx",
                "eas-cli@24.10.0",
                "build",
                "--profile",
                parameters.right[1],
                "--platform",
                parameters.right[2],
                "--non-interactive",
                "--wait",
              ],
              {
                cwd: new URL("..", import.meta.url),
                stdio: "inherit",
                shell: false,
                env: process.env,
              },
            );
            child.once("error", () => resolve(1));
            child.once("exit", (code) => resolve(code ?? 1));
          }),
        catch: () => ({ _tag: "MobileBuildUnavailable" }),
      }),
    ),
  );
  process.exitCode = Either.isRight(outcome) ? outcome.right : 1;
}
