/** Match the configured renderer document while allowing local hash navigation. */
export function isRendererDocument(candidate: string | undefined, expected: string): boolean {
  if (!candidate || !URL.canParse(candidate) || !URL.canParse(expected)) return false;
  const actualUrl = new URL(candidate);
  const expectedUrl = new URL(expected);
  actualUrl.hash = "";
  expectedUrl.hash = "";
  return actualUrl.href === expectedUrl.href;
}
