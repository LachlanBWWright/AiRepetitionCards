# Buttons and disclosures

Web and Electron use `@recall/ui-web` buttons. Both the package entry point and
`components/button` export the same shadcn primitive. Primary, secondary, and destructive styles distinguish action priority. Ghost is reserved for compact dismissal controls and the AI usage meter. Callers must not override label colours, including nested label text:

| Variant       | Purpose                                         |
| ------------- | ----------------------------------------------- |
| `default`     | The main action in a form or action group       |
| `secondary`   | Cancel, tools, restore and alternative actions  |
| `destructive` | Explicit deletion or destructive confirmation   |
| `ghost`       | Compact close icons and AI usage indicator only |

Navigation uses ordinary anchors with a visible underline and keyboard focus.
Use shared `NavigationLink` / `NativeNavigationLink` for blue subject navigation;
web links retain real destinations and modifier-click behavior, and locked links
cannot activate. Do not restyle action buttons into navigation links.
A sign-in or account-connection call to action may compose an anchor into a
primary button while retaining link semantics. In-app commands remain
action buttons; do not invent placeholder URLs for callbacks.

The stock `outline` and `link` variants and legacy `primary`, `danger`,
`small`, `medium`, `large`, `xs` and `icon-xs` aliases are removed. Use the shared `secondary` variant for quieter actions. Ghost must not be used for ordinary actions, text cancel buttons, or general toolbar controls. Size and content
layout are independent of visual purpose; review ratings and clickable rows keep
their specialized shared layouts.

Standard actions and adjacent default text inputs/selects are 40px high, compact toolbar actions are 32px, and large actions
are 48px. Matching icon sizes are `icon`, `icon-sm`, and `icon-lg`. Use `row`
for clickable list content, and `rating` for
review answers with a scheduling delay. Layout classes such as width, alignment,
and spacing between controls belong to callers. Heights, padding, rounding,
backgrounds, borders, and label typography belong to shared primitives.

Inputs, textareas, and selects fill their form column by default. Give compact
desktop fields and toolbar selects explicit responsive widths; short labels must
not determine form-field width. Keep composite controls, such as model selection
with a refresh icon, inside one full-width row with a flexible field.

Use `FormActions` for primary/secondary form commands. `DialogFooter` and
`AlertDialogFooter` share this layout: direct button children fill the available
width below 640px, then fit their labels and align right on larger screens. Write
secondary actions first and the primary action last; the phone stack reverses
that order. Do not override footers with centred alignment or local width rules.
Alternative import/export choices fill a phone column and fit their labels on
desktop. Library search spans the phone toolbar, with the objective filter and
tools button sharing the next row; wide desktop toolbars keep all three together.
Native forms retain stacked full-width controls and 48px minimum targets. Native
publishing uses shared selects and text fields instead of content-sized choice
button rows. Electron renders the shared web layouts.

Native buttons live in `@recall/ui-native`. App-local import paths re-export this
implementation. Actions have a minimum 48px touch target and a shared 14px label;
long labels may wrap. `selected` supplies selection styling. Native uses `default`, `secondary` and `destructive`, with `ghost` available for compact close controls; its former `tone` alias and unused link variant are removed. Native checkboxes,
radio choices, media gestures, and composite navigation rows retain their own
interaction semantics rather than becoming action buttons.

Use the styled shadcn `Collapsible`, `CollapsibleTrigger`, and `CollapsibleContent`
for independent disclosure sections. Triggers include their chevron, focus ring,
hover and disabled states. Do not nest ordinary buttons in them or add a second
chevron. Use the shared shadcn Accordion for grouped sections. Answer reveal,
rating, timer start/stop, and parameter fitting remain actions, not disclosures.
Native equivalents use `NativeCollapsible` or its controlled trigger/content pair;
these preserve platform accessibility and touch targets.

The source audit covered action buttons, styled links, disclosure triggers, native
Pressables, specialized action wrappers, and the shared sidebar navigation
primitives. Sidebar navigation and native selection controls remain specialized
primitives. Electron renders the shared web controls. Native uses its platform
controls rather than DOM-based Radix components.

Run `pnpm check:ui-controls` to inventory button purposes and reject legacy or
unknown variants/sizes, tone aliases, local appearance overrides, raw DOM
buttons/selects/disclosures and action buttons masquerading as disclosure triggers.
Shared shadcn implementations and semantic form-submit children of dropdown menu
items retain narrowly scoped exceptions. It also runs under `policy:static`. Regression tests live in
`pnpm test:ui-controls`. Storybook's **Design System / Control patterns** shows
standard, compact, disabled, icon, dialog, and disclosure controls together.

Use single-axis flex layouts for vertical form and section stacks. Keep an 8px
label/field gap, 16px between related controls, and 24px between sections. Use
CSS grid for genuine aligned columns, including the simulator's shared label
rows and the assistance action grid. Avoid combining parent gaps with repeated
child margins or nested padded panels. Keep semantic sections, fieldsets, scroll
containers and responsive column boundaries where they serve a purpose.

Settings and simulator forms cap at 48rem; insights cap at 56rem. Controls fill
their form column and long text wraps inside `min-w-0` flex children. Dialogs
keep their shared width cap. Native layouts use the same spacing rhythm with
48px minimum control targets and their existing platform-specific controls.

Avoid disclosures for a short explanation or a single field. Suggested-card
rationales and source references render directly. The library duplicate finder
opens a shared shadcn dialog from Card tools instead of silently expanding library
content. Keep genuine optional details in shared disclosure controls, and keep
answer reveal, pagination, mode changes and start/stop actions as actions.

`apps/web/tests/e2e/spacing.test.mjs` checks rendered section separation, label gaps,
field widths/heights and aligned mobile actions at phone and desktop widths. Keep
these browser geometry checks separate from visual taste: they prevent the doubled
parent/child spacing and uneven fields found during the spacing audit. Dedicated
Storybook fixtures cover portable deck previews and expanded appearance/speech
settings rather than relying on dashboard stories to reach those states.

`apps/web/tests/e2e/control-widths.test.mjs` checks modal actions, publishing field
columns, and library filter rows at 320px, 390px, and 1440px. It also checks that
long model options stay within the phone viewport and that blue subject links
respect locked workspaces.

Materials use Import → Check text → Choose topics → Generate sections. Review settings separate daily study, scheduling, presets and personalization. Task sections keep their content mounted so drafts survive navigation. Publishing separates Publish and Receive. Electron shares the web implementation; native uses shared selects for section navigation.

## Study workspace hierarchy

Home has one primary daily-review entry point. Per-subject review commands,
card overflow menus, selection tools, account exports, and practice alternatives
use secondary controls. Tutor and Improve links navigate to real subject routes.
Empty Home omits review/filter controls and offers a direct first-subject action.
Shared native rating controls use `size="rating"` to keep labels above their delay;
card questions use the shared content disclosure variant rather than local
control appearance overrides. See [the frontend design review](frontend-design-review.md)
for the screen-by-screen findings and verification boundaries.
