# Card equations and supporting explanations

Use the **Equation** button in a card field to open the equation composer. Select existing
text first to replace it. Choose inline notation for a sentence or display notation for a
separate equation. Fraction, root, quadratic and matrix examples provide starting points.
The live preview and TeX error message help correct mistakes before insertion. Equations
that exceed the field's length limit cannot be inserted.

The same workflow is available in web/Electron and native mobile editors. Math is rendered
locally with the bundled MathJax adapter. No external fonts, extension downloads or LaTeX
installation are needed. The supported package set remains base, AMS and local macro definitions.

```text
Inline: \(E = mc^2\)

Display:
\[
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
\]
```

Existing dollar-delimited equations remain supported. Prefer `\(...\)` and `\[...\]` for
new content: these unambiguously distinguish mathematics from currency. Escape literal dollar
signs as `\$`. Inline code and fenced code blocks preserve their contents without interpreting
math or formatting inside them. Fenced code supports an optional language label; it is displayed
in a scrollable monospace block. It does not execute code or apply syntax highlighting.

Cloze deletions can contain equations with nested TeX groups, for example:

```text
Simplify {{c1::\(\frac{a}{\frac{b}{c}}\)::fraction}}.
```

## Answer and explanation

Keep the **Answer** field short enough to judge whether you recalled it. Use the optional
**Explanation** field for reasoning, worked examples and source notes. It supports the same
formatting, equations and attached-image references. During review, supporting material is
available in an expandable section only after revealing the answer. Typed-answer comparison
continues to use the answer rather than the explanation.

Explanations are limited to 10,000 characters. Editing or clearing them preserves card identity,
scheduling and append-only review history; existing content snapshots support recovery.
Older cards need no migration. An omitted field in older editing commands preserves an existing
explanation, while an explicitly empty value clears it.

Shared note types have an optional explanation template, which supports the same field
substitutions as their question and answer templates. Ordinary cloze cards retain explanations
in their shared source note when generating siblings.

Explanations are authored content. They persist in device storage, recoverable drafts, private
backups, portable decks, CSV/TSV, account sync, and published releases/forks. Publishing an explanation
shares its contents along with the card. Anki exports retain supporting material on the answer
side; imported Anki layouts may combine it with the answer rather than keeping a separate field.
