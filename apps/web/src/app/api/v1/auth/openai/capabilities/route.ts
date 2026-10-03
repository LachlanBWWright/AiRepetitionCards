import { observeRoute } from "@/lib/http/observe-route";
import { getOpenAiSignInCapabilities } from "@/lib/auth/openai-config";
import { privateJson } from "@/lib/http/private-json";

async function handleGET() {
  return privateJson(getOpenAiSignInCapabilities(), {
    headers: { "cache-control": "private, no-store" },
  });
}

export const GET = observeRoute("openai-sign-in-capabilities", handleGET);
