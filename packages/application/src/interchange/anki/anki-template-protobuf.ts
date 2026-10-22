/** Anki Notetype.Template.Config string fields 1/2 (q_format/a_format). Unknown fields are skipped. */
export function decodeAnkiTemplateConfig(
  input: unknown,
): { readonly front: string; readonly back: string } | undefined {
  if (!(input instanceof Uint8Array) || input.length > 1_000_000) return undefined;
  let offset = 0;
  let front = "";
  let back = "";
  const read = (): number | undefined => {
    let result = 0;
    let shift = 0;
    while (offset < input.length && shift < 70) {
      const byte = input[offset++];
      if (byte === undefined) return undefined;
      if (shift === 63 && byte > 1) return undefined;
      result += (byte & 127) * 2 ** shift;
      if ((byte & 128) === 0) return result;
      shift += 7;
    }
    return undefined;
  };
  while (offset < input.length) {
    const tag = read();
    if (tag === undefined || !Number.isSafeInteger(tag) || tag === 0 || tag > 0xffffffff)
      return undefined;
    const wire = tag & 7;
    const field = tag >>> 3;
    if (wire === 2) {
      const length = read();
      if (length === undefined || !Number.isSafeInteger(length) || length > input.length - offset)
        return undefined;
      const bytes = input.subarray(offset, offset + length);
      offset += length;
      if (field === 1) front = new TextDecoder().decode(bytes);
      if (field === 2) back = new TextDecoder().decode(bytes);
    } else if (wire === 0) {
      if (read() === undefined) return undefined;
    } else if (wire === 1) offset += 8;
    else if (wire === 5) offset += 4;
    else return undefined;
    if (offset > input.length) return undefined;
  }
  return { front, back };
}
