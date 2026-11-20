import { Effect } from "effect";
export const fundingKey = (owner: string) => `recall-ai-funding:${owner}`;
export function readFundingPreference(owner: string) {
  return Effect.try({
    try: () => localStorage.getItem(fundingKey(owner)),
    catch: () => ({ message: "AI preference storage is unavailable." }),
  });
}
export function writeFundingPreference(owner: string, mode: "byo" | "managed") {
  return Effect.try({
    try: () => {
      localStorage.setItem(fundingKey(owner), mode);
    },
    catch: () => ({ message: "Could not save the AI funding choice." }),
  });
}
