const vm = require("node:vm");
const fs = require("node:fs");
const source = fs.readFileSync("source.js", "utf8");
const request = JSON.parse(fs.readFileSync(0, "utf8"));
const context = vm.createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
  microtaskMode: "afterEvaluate",
});
new vm.Script(
  'Object.freeze(JSON); Object.defineProperty(globalThis, "JSON", {value:JSON,writable:false,configurable:false});',
).runInContext(context, { timeout: 500 });
new vm.Script('"use strict";\n' + source).runInContext(context, { timeout: 500 });
const encoded = new vm.Script(
  "JSON.stringify(solve(..." + JSON.stringify(request.input) + "))",
).runInContext(context, { timeout: 500 });
process.stdout.write(encoded);
