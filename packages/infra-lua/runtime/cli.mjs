import { execute } from "./execute.mjs";
let input = "";
let oversized = false;
for await (const chunk of process.stdin) {
  input += chunk.toString();
  if (Buffer.byteLength(input) > 65536) {
    oversized = true;
    break;
  }
}
let result;
try {
  result = oversized
    ? { ok: false, error: { code: "budget", message: "Input budget exceeded" } }
    : await execute(JSON.parse(input));
} catch {
  result = { ok: false, error: { code: "invalid-request", message: "Invalid JSON request" } };
}
process.stdout.write(JSON.stringify(result) + "\n");
