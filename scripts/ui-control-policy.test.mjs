import assert from "node:assert/strict";
import test from "node:test";
import { controlViolations } from "./ui-control-policy.mjs";

const audit = (source) => controlViolations(source, "fixture.tsx");
test("layout and named button sizes are allowed", () => {
  assert.deepEqual(
    audit('<Button size="sm" variant="default" className="w-full sm:w-fit gap-2">Save</Button>'),
    [],
  );
});
test("local dimensions and appearance are rejected, including responsive and dynamic classes", () => {
  for (const source of [
    '<Button className="h-7 px-2" />',
    '<Button className="text-muted-foreground" />',
    '<Button><span className="text-muted-foreground">Back</span></Button>',
    '<Button className="hover:text-gray-400" />',
    '<NativeButton className="text-recall-muted" />',
    '<NativeButton className={"min-h-[38px] rounded-xl"} />',
    '<Button className={`sm:h-8 ${busy ? "bg-red-500" : "bg-white"}`} />',
    '<NativeButton labelClassName="text-[11px]" />',
  ])
    assert.ok(audit(source).length > 0);
});
test("disclosures use the styled primitive rather than wrapping action buttons", () => {
  assert.ok(
    audit("<CollapsibleTrigger asChild><Button>Details</Button></CollapsibleTrigger>").length > 0,
  );
  assert.deepEqual(audit("<CollapsibleTrigger disabled={busy}>Details</CollapsibleTrigger>"), []);
});

test("form submissions use standard action sizing", () => {
  assert.ok(audit('<Button type="submit" size="sm">Save</Button>').length > 0);
  assert.deepEqual(audit('<Button type="submit">Save</Button>'), []);
});

test("button purposes reject duplicate aliases and unknown types", () => {
  for (const source of [
    '<Button variant="ghost" />',
    '<Button variant="link" />',
    '<Button size="inline" />',
    '<Button variant="outline" />',
    '<Button variant="primary" />',
    '<Button variant="danger" />',
    '<Button size="xs" />',
    '<NativeButton tone="soft" />',
  ])
    assert.ok(audit(source).length > 0);
  assert.deepEqual(audit('<Button variant={busy ? "destructive" : "default"} />'), []);
});
test("handrolled controls and mismatched disclosure buttons are rejected", () => {
  for (const source of [
    "<details><summary>More</summary></details>",
    "<select />",
    "<button>More</button>",
    "<Button aria-expanded={open}>More</Button>",
  ])
    assert.ok(audit(source).length > 0);
  assert.deepEqual(
    audit('<DropdownMenuItem asChild><button type="submit">Sign out</button></DropdownMenuItem>'),
    [],
  );
});

test("ghost is limited to compact close controls and the usage meter", () => {
  assert.deepEqual(
    audit('<Button variant="ghost" size="icon-sm" aria-label="Close dialog" />'),
    [],
  );
  assert.deepEqual(
    audit('<NativeButton variant="ghost" size="icon" accessibilityLabel="Close dialog" />'),
    [],
  );
  assert.deepEqual(
    controlViolations(
      '<Button variant="ghost" size="sm" />',
      "apps/web/src/components/tutor/chat/ChatContextMeter.tsx",
    ),
    [],
  );
  assert.ok(audit('<Button variant="ghost" size="sm">Save</Button>').length > 0);
  assert.ok(audit('<Button variant={busy ? "ghost" : "default"}>Save</Button>').length > 0);
  assert.ok(
    audit('<Button variant="ghost" size="icon" aria-label="Close" type="submit" />').length > 0,
  );
});

test("secondary actions use the shared variant across platforms", () => {
  assert.deepEqual(
    audit(
      '<Button variant="secondary">Cancel</Button><NativeButton variant="secondary" label="Cancel" />',
    ),
    [],
  );
});
