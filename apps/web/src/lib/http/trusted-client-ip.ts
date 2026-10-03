import "server-only";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { Effect } from "effect";

export type TrustedClientIpFailure = {
  readonly _tag: "TrustedClientIpUnavailable";
  readonly reason: "configuration" | "request" | "header" | "hash";
};
const unavailable = (reason: TrustedClientIpFailure["reason"]): TrustedClientIpFailure => ({
  _tag: "TrustedClientIpUnavailable",
  reason,
});

/** Canonical address text exists only transiently, before keyed hashing. */
function canonicalAddress(value: string): string | null {
  if (value.length > 45 || !/^[0-9a-f:.]+$/i.test(value)) return null;
  const family = isIP(value);
  if (family === 4) return `ipv4:${value}`;
  if (family !== 6) return null;
  let address = value.toLowerCase();
  if (address.includes(".")) {
    const split = address.lastIndexOf(":");
    const octets = address
      .slice(split + 1)
      .split(".")
      .map(Number);
    const [a, b, c, d] = octets;
    if (a === undefined || b === undefined || c === undefined || d === undefined) return null;
    address = `${address.slice(0, split + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const parts = address.split("::");
  const left = parts[0] ? parts[0].split(":") : [];
  const right = parts[1] ? parts[1].split(":") : [];
  const groups =
    parts.length === 1
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  const words = groups.map((group) => Number.parseInt(group, 16));
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word))) return null;
  // Proxies may represent IPv4 peers as mapped IPv6; keep their bucket identical.
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff) {
    const high = words[6];
    const low = words[7];
    if (high === undefined || low === undefined) return null;
    return `ipv4:${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `ipv6:${words.map((word) => word.toString(16).padStart(4, "0")).join(":")}`;
}

/** Enabled only by an explicit trusted-proxy header and secret; never infer proxy trust. */
export function trustedClientIpSubject(
  request?: Request,
): Effect.Effect<string | null, TrustedClientIpFailure> {
  return Effect.gen(function* () {
    const header = process.env.API_RATE_LIMIT_TRUSTED_IP_HEADER;
    const secret = process.env.API_RATE_LIMIT_IP_HMAC_SECRET;
    if (!header?.trim() && !secret?.trim()) return null;
    if (
      !header ||
      !/^[a-z0-9][a-z0-9-]{0,126}$/i.test(header) ||
      !secret ||
      secret.trim().length < 32 ||
      secret.length > 4096
    ) {
      return yield* Effect.fail(unavailable("configuration"));
    }
    if (!request) return yield* Effect.fail(unavailable("request"));
    const raw = request.headers.get(header.toLowerCase());
    const address = raw === null ? null : canonicalAddress(raw.trim());
    if (!address) return yield* Effect.fail(unavailable("header"));
    return yield* Effect.try({
      try: () => createHmac("sha256", secret).update(address).digest("hex"),
      catch: () => unavailable("hash"),
    });
  });
}
