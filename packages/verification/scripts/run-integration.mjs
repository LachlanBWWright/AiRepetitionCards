import { integrationConfiguration } from "./integration-config.mjs";

const result = integrationConfiguration(process.env);
const args = process.argv.slice(2);
if (result.error) {
  process.stderr.write(`${result.error}\nNo integration checks ran.\n`);
  process.exitCode = 1;
} else if (args.length === 1 && args[0] === "--check-config") {
  process.stdout.write("Local integration configuration accepted; no services contacted.\n");
} else {
  const { runSuite } = await import("./run-suite.mjs");
  await runSuite("integration", args);
}
