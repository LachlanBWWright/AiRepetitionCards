import { spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { integrationConfiguration } from "../packages/verification/scripts/integration-config.mjs";

if (process.env.GITHUB_ACTIONS !== "true" || !process.env.GITHUB_ENV) {
  process.stderr.write("This credential bridge requires a GitHub Actions environment.\n");
  process.exitCode = 1;
} else {
  const status = spawnSync("pnpm", ["exec", "supabase", "status", "--output", "json"], {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  if (status.error || status.status !== 0) {
    process.stderr.write("Could not read the disposable local Supabase configuration.\n");
    process.exitCode = 1;
  } else {
    try {
      const data = JSON.parse(status.stdout);
      const environment = {
        RECALL_INTEGRATION_SUPABASE_URL: data.API_URL,
        RECALL_INTEGRATION_SUPABASE_PUBLISHABLE_KEY: data.ANON_KEY,
        RECALL_INTEGRATION_SUPABASE_SERVICE_ROLE_KEY: data.SERVICE_ROLE_KEY,
      };
      const result = integrationConfiguration(environment);
      if (result.error) {
        process.stderr.write(`${result.error}\n`);
        process.exitCode = 1;
      } else {
        for (const value of Object.values(environment)) {
          process.stdout.write(`::add-mask::${value}\n`);
        }
        appendFileSync(
          process.env.GITHUB_ENV,
          Object.entries(environment)
            .map(([name, value]) => `${name}=${value}\n`)
            .join(""),
        );
        process.stdout.write("Disposable integration credentials configured.\n");
      }
    } catch {
      process.stderr.write("Could not configure disposable integration credentials.\n");
      process.exitCode = 1;
    }
  }
}
