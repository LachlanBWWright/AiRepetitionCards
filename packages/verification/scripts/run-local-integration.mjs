import { runSuite } from "./run-suite.mjs";

await runSuite("local-integration", process.argv.slice(2));
