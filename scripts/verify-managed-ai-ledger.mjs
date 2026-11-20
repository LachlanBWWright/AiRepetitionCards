import assert from "node:assert/strict";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const run = promisify(execFile);
const name = `recall-managed-ai-check-${process.pid}`;
const docker = (args, input) =>
  execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const query = (sql) =>
  docker(["exec", "-i", name, "psql", "-U", "postgres", "-At", "-v", "ON_ERROR_STOP=1"], sql);
try {
  docker([
    "run",
    "--rm",
    "-d",
    "--name",
    name,
    "-e",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:16-alpine",
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      query("select 1;");
      ready = true;
      break;
    } catch {
      await delay(250);
    }
  }
  assert.ok(ready, "Isolated Postgres failed to start");
  query(
    "create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key);",
  );
  query(readFileSync("supabase/migrations/20261105000000_managed_ai.sql", "utf8"));
  query(readFileSync("supabase/tests/managed-ai.sql", "utf8"));
  const owner = "a1111111-1111-4111-8111-111111111111";
  query(`insert into auth.users values ('${owner}');
    update managed_ai_policy set enabled=true where id;
    insert into managed_ai_deployments values ('test','openai','fixture-model',true,96000,2600,'v1',1000000,2000000);
    insert into managed_ai_routes values ('question','test');
    insert into managed_ai_grants values ('${owner}',now()+interval '1 day',true,array['test'],1000000,30,1);`);
  const results = await Promise.all(
    Array.from({ length: 8 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
      const sql = `select managed_ai_reserve('${owner}','${id}','question','test','v1','fixture-model',1000,100)->>'allowed';`;
      return run("docker", [
        "exec",
        name,
        "psql",
        "-U",
        "postgres",
        "-At",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ]);
    }),
  );
  assert.equal(
    results.filter((result) => result.stdout.trim() === "true").length,
    1,
    "Concurrent admission overspent or ignored its concurrency limit",
  );
  assert.equal(query("select count(*) from managed_ai_calls;").trim(), "1");
  console.log("Managed AI ledger: rollback fixtures and 8 simultaneous admission attempts passed.");
} finally {
  try {
    docker(["rm", "-f", name]);
  } catch {
    /* Container may not have started. */
  }
}
