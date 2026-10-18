import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Effect, Either, Schema } from "effect";
import { AuthSessionResponseSchema, WorkspaceSnapshotSchema } from "@recall/contracts";
import { parseKnowledgeAreaJson } from "@recall/domain";

const directory = resolve(process.cwd(), "../../contracts/fixtures/dotnet-v1");
const Manifest = Schema.Array(
  Schema.Struct({
    file: Schema.String,
    contract: Schema.Literal("auth-session", "workspace-snapshot"),
    schemaValid: Schema.Boolean,
    valid: Schema.Boolean,
  }),
);
void test("shared .NET fixture corpus matches Effect shape and semantic validation", async () => {
  const manifest: unknown = JSON.parse(await readFile(resolve(directory, "manifest.json"), "utf8"));
  const cases = Schema.decodeUnknownSync(Manifest)(manifest);
  assert.ok(cases.length >= 15);
  for (const entry of cases) {
    const input: unknown = JSON.parse(await readFile(resolve(directory, entry.file), "utf8"));
    if (entry.contract === "auth-session") {
      const decoded = Schema.decodeUnknownEither(AuthSessionResponseSchema)(input, {
        onExcessProperty: "error",
      });
      assert.equal(Either.isRight(decoded), entry.schemaValid, entry.file);
      assert.equal(Either.isRight(decoded), entry.valid, entry.file);
      continue;
    }
    const decoded = Schema.decodeUnknownEither(WorkspaceSnapshotSchema)(input, {
      onExcessProperty: "error",
    });
    assert.equal(Either.isRight(decoded), entry.schemaValid, entry.file);
    const valid =
      Either.isRight(decoded) &&
      decoded.right.areas.every(({ document }) =>
        Either.isRight(
          Effect.runSync(Effect.either(parseKnowledgeAreaJson(JSON.stringify(document)))),
        ),
      );
    assert.equal(valid, entry.valid, entry.file);
  }
});
