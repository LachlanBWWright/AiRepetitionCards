import assert from "node:assert/strict";
import test from "node:test";
import { createAreaId } from "@recall/domain";
import { createEditorBuilders } from "../../../../apps/mobile/src/components/authoring/workflows/EditorBuilders";
import { workspace, card } from "../review/advanced/fixtures";

await test("browsing another subject builds its editor and baseline without changing the active subject", () => {
  const original = workspace([card("one")]);
  const area = original.areas[0];
  assert.ok(area);
  const destination = {
    ...area,
    id: createAreaId("second-area"),
    title: "Other subject",
    cards: [card("two")],
  };
  const current = { ...original, areas: [area, destination] };
  const builders = createEditorBuilders({ workspace: current, area, createId: () => "unused" });
  const editor = builders.cardEditor(0, "basic", destination);
  assert.ok(editor?.kind === "card");
  assert.equal(editor.areaId, destination.id);
  assert.equal(editor.id, destination.cards[0]?.id);
  assert.equal(editor.content.front, destination.cards[0]?.front);
  assert.ok(editor.baseline);
  assert.equal(current.areas[0], area);
});
