/** HTML-free card content shared by web and native clients. */
export type RichInline =
  | { readonly kind: "text" | "strong" | "emphasis" | "code" | "math"; readonly text: string }
  | { readonly kind: "image"; readonly text: string; readonly mediaId: string };
export type RichBlock = {
  readonly kind: "paragraph" | "heading" | "quote" | "bullet" | "number" | "math" | "code";
  readonly content: readonly RichInline[];
  readonly number?: number;
  readonly language?: string;
};
