const names = [
  "RECALL_INTEGRATION_SUPABASE_URL",
  "RECALL_INTEGRATION_SUPABASE_PUBLISHABLE_KEY",
  "RECALL_INTEGRATION_SUPABASE_SERVICE_ROLE_KEY",
];

function keyRole(key) {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return "anon";
  if (/^sb_secret_[A-Za-z0-9_-]+$/.test(key)) return "service_role";
  if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(key.split(".")[1] ?? "", "base64url").toString());
    return typeof payload === "object" && payload !== null ? payload.role : undefined;
  } catch {
    return undefined;
  }
}

export function integrationConfiguration(environment) {
  for (const name of names) {
    const value = environment[name];
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
      return { error: `Set ${name} explicitly for the local integration suite.` };
    }
  }
  let url;
  try {
    url = new URL(environment[names[0]]);
  } catch {
    return { error: "Integration Supabase URL is invalid." };
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    return {
      error: "Integration Supabase URL must be a loopback origin without credentials or a path.",
    };
  }
  const publishableKey = environment[names[1]];
  const serviceRoleKey = environment[names[2]];
  if (
    ![publishableKey, serviceRoleKey].every((key) => /^[\x21-\x7e]{1,8192}$/.test(key)) ||
    keyRole(publishableKey) !== "anon" ||
    keyRole(serviceRoleKey) !== "service_role"
  ) {
    return { error: "Integration keys must be a public/anon key and a separate service-role key." };
  }
  return { config: { url: url.origin, publishableKey, serviceRoleKey } };
}
