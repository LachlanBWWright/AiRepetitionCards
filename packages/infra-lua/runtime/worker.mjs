import { parentPort, workerData } from "node:worker_threads";
import { LuaFactory, LuaLibraries } from "wasmoon";

// Only this trusted bootstrap sees standard libraries; activity code sees `env`.
const bootstrap = `
local seed = SEED
local remaining = 100000
local function budget()
  remaining = remaining - 100
  if remaining <= 0 then error('instruction budget exceeded', 0) end
end
debug.sethook(budget, '', 100)
local null = {}
local env = {type=type, tonumber=tonumber, tostring=tostring,
  ipairs=ipairs, pairs=pairs, next=next, select=select, assert=assert,
  json_null=null, math={abs=math.abs,floor=math.floor,ceil=math.ceil,
  min=math.min,max=math.max,sqrt=math.sqrt}}
env.random = function()
  seed = (seed * 1664525 + 1013904223) % 4294967296
  return seed / 4294967296
end
local function quote(s)
  return '"' .. s:gsub('[%z\\1-\\31\\\\"]', function(c)
    if c == '"' then return '\\\\"' end
    if c == '\\\\' then return '\\\\\\\\' end
    return string.format('\\\\u%04x', string.byte(c))
  end) .. '"'
end
local size = 0
local seen = {}
local function encode(v, depth)
  if depth > 16 then error('JSON depth exceeded') end
  local t = type(v)
  if v == null then return 'null' end
  if t == 'nil' then return 'null' end
  if t == 'boolean' then return tostring(v) end
  if t == 'number' then
    assert(v == v and v ~= math.huge and v ~= -math.huge, 'finite JSON numbers required')
    return tostring(v)
  end
  if t == 'string' then
    size = size + #v
    assert(size <= 32768, 'message budget exceeded')
    return quote(v)
  end
  assert(t == 'table' and not seen[v], 'JSON values required')
  seen[v] = true
  local count, array = 0, true
  for k in pairs(v) do
    count = count + 1
    assert(count <= 2048, 'message budget exceeded')
    if type(k) ~= 'number' or k < 1 or k % 1 ~= 0 then array = false end
  end
  if count ~= #v then array = false end
  local parts = {}
  if array and count > 0 then
    for i=1,count do parts[i] = encode(v[i],depth+1) end
  else
    for k,value in pairs(v) do
      assert(type(k) == 'string', 'JSON object keys required')
      parts[#parts+1] = quote(k)..':'..encode(value,depth+1)
    end
    table.sort(parts)
  end
  seen[v] = nil
  local result = (array and count > 0) and '['..table.concat(parts,',')..']' or '{'..table.concat(parts,',')..'}'
  assert(#result <= 32768, 'message budget exceeded')
  return result
end
local activity = assert(load(SCRIPT, 'activity', 't', env))()
assert(type(activity) == 'table', 'script must return activity table')
local result
if OPERATION == 'init' then result = activity.init(CONFIGURATION, SEED)
elseif OPERATION == 'view' then result = activity.view(STATE)
elseif OPERATION == 'update' then result = activity.update(STATE, EVENT)
elseif OPERATION == 'assess' then result = activity.assess(STATE)
else error('invalid operation') end
return encode(result, 0)
`;

function literal(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    return (
      '"' +
      [...new TextEncoder().encode(value)]
        .map((byte) => "\\" + String(byte).padStart(3, "0"))
        .join("") +
      '"'
    );
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return (
    "{" +
    Object.entries(value)
      .map(
        ([key, child]) =>
          "[" + (Array.isArray(value) ? Number(key) + 1 : literal(key)) + "]=" + literal(child),
      )
      .join(",") +
    "}"
  );
}

let engine;
try {
  engine = await new LuaFactory().createEngine({
    openStandardLibs: false,
    injectObjects: false,
    enableProxy: false,
    traceAllocations: true,
  });
  for (const library of [
    LuaLibraries.Base,
    LuaLibraries.Math,
    LuaLibraries.String,
    LuaLibraries.Table,
    LuaLibraries.Debug,
  ])
    engine.global.loadLibrary(library);
  engine.global.setMemoryMax(4 * 1024 * 1024);
  // Constants are compiled into trusted code; no host object or JS function crosses the VM boundary.
  const constants = {
    SCRIPT: workerData.script,
    SEED: workerData.seed,
    OPERATION: workerData.operation,
    CONFIGURATION: workerData.configuration,
    STATE: workerData.state,
    EVENT: workerData.event,
  };
  const source = bootstrap.replace(
    /\b(SCRIPT|SEED|OPERATION|CONFIGURATION|STATE|EVENT)\b/g,
    (name) => literal(constants[name]),
  );
  const output = engine.doStringSync(source);
  if (typeof output !== "string" || Buffer.byteLength(output) > 32768)
    parentPort.postMessage({
      ok: false,
      error: { code: "budget", message: "Lua output budget exceeded" },
    });
  else parentPort.postMessage({ ok: true, value: JSON.parse(output) });
} catch (error) {
  const message = error instanceof Error ? error.message : "Lua execution failed";
  parentPort.postMessage({
    ok: false,
    error: {
      code: /budget|memory|alloc/i.test(message) ? "budget" : "execution",
      message: message.slice(0, 512),
    },
  });
} finally {
  engine?.global.close();
}
