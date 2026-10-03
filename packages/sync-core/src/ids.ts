export function stableSyncId(seed: string): string {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35].map((initial, index) => {
    let hash = initial ^ index;
    for (const character of seed) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
    return (hash >>> 0).toString(16).padStart(8, "0");
  });
  const hex = hashes.join("");
  const variant = (8 + (Number.parseInt(hex[16] ?? "8", 16) % 4)).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20)}`;
}
