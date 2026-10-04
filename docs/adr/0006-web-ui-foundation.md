# ADR 0006: Source-owned shadcn web components

## Decision

`@recall/ui-web` owns the shared DOM component source for web and Electron. Its Button uses shadcn's Radix Slot composition pattern, class-variance-authority variants and a `cn` utility built from clsx and tailwind-merge. Existing product imports use this implementation through the package barrel and compatibility export. Primary/secondary/quiet/danger and small/medium remain supported; standard variant/size aliases and `asChild` support composition.

The package's stylesheet owns the Tailwind v4 import and explicitly scans its source. Semantic Tailwind colors/radii map to the generated Recall design tokens. Next.js, Electron and Storybook consume the same stylesheet. Shared components import React and UI utilities, with framework-specific composition kept in application workspaces.

Matching `components.json` files in web and the shared package route new component source and utilities into `packages/ui-web`. Package exports resolve the configured cross-workspace aliases. Tailwind v4 has no separate Tailwind configuration path. New generated components are application-owned code and must be reviewed for strict types, accessibility, dependency direction and product styling before adoption.

## Dialog adaptation

The shared Dialog retains Recall's current controlled API, labelled dialog semantics, initial focus, Escape handling, focus containment and focus restoration. This source-owned adaptation preserves existing product forms while Button establishes the shared shadcn foundation. Replacing the dialog implementation must preserve those behaviors, its existing consumers and full-screen mock stories. Browser accessibility acceptance remains a separate gate.

## Composition

`asChild` requires one element. A composed anchor retains link semantics; ordinary Button defaults to `type="button"`. Disabled composed links receive `aria-disabled`, leave the tab order and prevent activation in capture handling. Use native buttons for actions and labelled links for navigation. Utility class overrides pass through `cn`; callers retain responsibility for an accessible label on icon controls.

## Sources

- [shadcn monorepo configuration](https://ui.shadcn.com/docs/monorepo)
- [components.json options](https://ui.shadcn.com/docs/components-json)
- [Radix Button composition](https://ui.shadcn.com/docs/components/radix/button)
- [Tailwind source detection](https://tailwindcss.com/docs/detecting-classes-in-source-files)
