import { runSuite } from "./run-suite.mjs";

await runSuite("tests", process.argv.slice(2));
