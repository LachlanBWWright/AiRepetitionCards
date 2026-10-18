import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_TUTOR_MODEL, selectTutorModel } from "@recall/application";
const models = [{ slug: "other-model" }, { slug: "gpt-6-luna" }];
void test("tutor defaults to GPT-6 Luna independently of catalog order", () => {
  assert.equal(DEFAULT_TUTOR_MODEL, "gpt-6-luna");
  assert.equal(selectTutorModel(models), "gpt-6-luna");
  assert.equal(selectTutorModel([...models].reverse()), "gpt-6-luna");
});
void test("a valid explicit model selection survives catalog refreshes", () => {
  assert.equal(selectTutorModel(models, "other-model"), "other-model");
  assert.equal(selectTutorModel(models, "removed-model"), "gpt-6-luna");
});
void test("model selection respects account availability", () => {
  assert.equal(selectTutorModel([{ slug: "available-model" }]), "available-model");
  assert.equal(selectTutorModel([], "gpt-6-luna"), "");
});
