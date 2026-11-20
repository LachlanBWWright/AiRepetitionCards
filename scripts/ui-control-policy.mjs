import ts from "typescript";

const actionTags = new Set([
  "Button",
  "ShadcnButton",
  "NativeButton",
  "NativeButtonPrimitive",
  "AlertDialogAction",
  "AlertDialogCancel",
]);
const disclosureTags = new Set([
  "CollapsibleTrigger",
  "AccordionTrigger",
  "TutorDisclosureTrigger",
]);
const variants = new Set(["default", "secondary", "destructive", "ghost"]);
const sizes = new Set(["default", "sm", "lg", "icon", "icon-sm", "icon-lg", "row", "rating"]);
function stringsIn(node) {
  const strings = [];
  const visit = (value) => {
    if (ts.isConditionalExpression(value)) {
      visit(value.whenTrue);
      visit(value.whenFalse);
      return;
    }
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
      strings.push(value.text);
    ts.forEachChild(value, visit);
  };
  visit(node);
  return strings;
}
const appearance =
  /(?:^|\s)(?:[\w-]+:)*(?:!?h-|min-h-|size-|rounded|p[xy]?-|bg-|border(?:-|\s|$)|shadow|text-\[(?:\d)|text-(?:xs|sm|base|lg|xl)(?:\s|$))/;

const labelAppearance =
  /(?:^|\s)(?:[\w-]+:)*!?text-(?!(?:left|center|right|justify|start|end|wrap|nowrap|balance|pretty)(?:\s|$))/;

const nestedLabelColor =
  /(?:^|\s)(?:[\w-]+:)*!?text-(?!(?:white|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|xs|sm|base|lg|xl|[2-9]xl)(?:\s|$)|\[\d)[^\s]+/;
function overridesAppearance(value, action, disclosure, insideAction) {
  return (
    ((action || disclosure) && appearance.test(value)) ||
    (action && labelAppearance.test(value)) ||
    (insideAction && nestedLabelColor.test(value))
  );
}

function ghostPurpose(value, path) {
  if (value("type") === "submit") return false;
  const compact = ["icon", "icon-sm"].includes(value("size"));
  const close = /^Close(?:\b|$)/.test(value("aria-label") ?? value("accessibilityLabel") ?? "");
  const sharedClose = ["dialog-close", "sheet-close"].includes(value("data-slot"));
  const usage = path.endsWith("/tutor/chat/ChatContextMeter.tsx") && value("size") === "sm";
  return (compact && (close || sharedClose)) || usage;
}

/** Component callers own layout; shared controls own dimensions and appearance. */
export function controlViolations(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations = [];
  const report = (node, message) => {
    violations.push(
      `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${message}`,
    );
  };
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      const action = actionTags.has(tag);
      let ancestor = node.parent;
      let insideAction = false;
      while (ancestor) {
        if (
          ts.isJsxElement(ancestor) &&
          actionTags.has(ancestor.openingElement.tagName.getText(file))
        ) {
          insideAction = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      if (["details", "summary", "select"].includes(tag))
        report(node, "Use shared shadcn controls instead of native disclosure/select markup.");
      if (tag === "button") {
        const parent = node.parent?.parent;
        const menuSubmit =
          parent &&
          ts.isJsxElement(parent) &&
          parent.openingElement.tagName.getText(file) === "DropdownMenuItem";
        if (!menuSubmit) report(node, "Use the shared Button or a shared shadcn control.");
      }
      const disclosure = disclosureTags.has(tag);
      if (action) {
        const value = (name) => {
          const attribute = node.attributes.properties.find(
            (item) => ts.isJsxAttribute(item) && item.name.getText(file) === name,
          );
          return attribute &&
            ts.isJsxAttribute(attribute) &&
            attribute.initializer &&
            ts.isStringLiteral(attribute.initializer)
            ? attribute.initializer.text
            : null;
        };
        const variant = node.attributes.properties.find(
          (item) => ts.isJsxAttribute(item) && item.name.getText(file) === "variant",
        );
        if (variant && stringsIn(variant).includes("ghost") && !ghostPurpose(value, path))
          report(
            node,
            "Ghost buttons are reserved for compact close controls and the AI usage meter.",
          );
        if (value("type") === "submit" && ["sm", "small", "xs"].includes(value("size")))
          report(node, "Form submit actions use the standard size, not a compact toolbar size.");
      }
      if (action || disclosure || insideAction) {
        for (const attribute of node.attributes.properties) {
          if (!ts.isJsxAttribute(attribute)) continue;
          const name = attribute.name.getText(file);
          if (disclosure && name === "asChild")
            report(attribute, "Use the styled disclosure trigger directly.");
          if (action && name === "tone")
            report(attribute, "Use a canonical button variant instead of tone aliases.");
          if (action && name === "aria-expanded")
            report(attribute, "Use a shared disclosure trigger for expanded content.");
          if (action && ["variant", "size"].includes(name) && attribute.initializer) {
            const allowed = name === "variant" ? variants : sizes;
            if (stringsIn(attribute.initializer).some((value) => !allowed.has(value)))
              report(
                attribute,
                `Unknown or legacy button ${name}; use the canonical purpose-specific API.`,
              );
          }
          if (action && name === "labelClassName")
            report(attribute, "Button label typography belongs to the shared component.");
          if (name !== "className" || !attribute.initializer) continue;
          const strings = [];
          const collect = (value) => {
            if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
              strings.push(value.text);
            if (ts.isTemplateHead(value) || ts.isTemplateMiddle(value) || ts.isTemplateTail(value))
              strings.push(value.text);
            ts.forEachChild(value, collect);
          };
          collect(attribute.initializer);
          if (strings.some((value) => overridesAppearance(value, action, disclosure, insideAction)))
            report(attribute, "Use shared sizes/variants instead of local control styling.");
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return violations;
}

/** Inventory complements enforcement: reviewers can compare actual purposes and disclosures. */
export function controlInventory(source, path) {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const counts = {};
  const visit = (node) => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(file);
      if (actionTags.has(tag)) {
        const attribute = node.attributes.properties.find(
          (item) => ts.isJsxAttribute(item) && item.name.getText(file) === "variant",
        );
        const values = attribute?.initializer ? stringsIn(attribute.initializer) : ["default"];
        for (const value of values.length ? values : ["dynamic"])
          counts[value] = (counts[value] ?? 0) + 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return counts;
}
