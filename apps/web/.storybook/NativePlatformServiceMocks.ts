/** In-memory files keep native stories independent of device filesystem services. */
const files = new Map<string, Uint8Array>();
type FileLocation = string | { readonly uri: string };
export const Paths = {
  cache: { uri: "storybook://cache" },
  document: { uri: "storybook://document" },
  bundle: { uri: "storybook://bundle" },
} as const;
export class File {
  readonly uri: string;
  constructor(...locations: readonly FileLocation[]) {
    this.uri = locations
      .map((location) => (typeof location === "string" ? location : location.uri))
      .join("/");
  }
  get exists() {
    return files.has(this.uri);
  }
  get size() {
    return files.get(this.uri)?.byteLength ?? 0;
  }
  create() {
    files.set(this.uri, new Uint8Array());
  }
  write(content: string | Uint8Array) {
    files.set(
      this.uri,
      typeof content === "string" ? new TextEncoder().encode(content) : content.slice(),
    );
  }
  delete() {
    files.delete(this.uri);
  }
  bytes() {
    return Promise.resolve(files.get(this.uri)?.slice() ?? new Uint8Array());
  }
  async text() {
    return new TextDecoder().decode(await this.bytes());
  }
}
/** Storybook cannot present a device share sheet; adapters surface their existing fallback. */
export const isAvailableAsync = () => Promise.resolve(false);
export const shareAsync = () => Promise.resolve(undefined);
