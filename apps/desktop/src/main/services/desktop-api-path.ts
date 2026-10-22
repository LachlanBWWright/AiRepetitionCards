export type DesktopApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const token = "[A-Za-z0-9_-]{43}";
const id = new RegExp(`^${uuid}$`, "i");
const routes: Readonly<Record<DesktopApiMethod, readonly RegExp[]>> = {
  GET: [
    /^\/api\/v1\/workspace$/,
    /^\/api\/v1\/workspace\/study$/,
    /^\/api\/v1\/sync$/,
    /^\/api\/v1\/tutor$/,
    /^\/api\/v1\/tutor\/privacy$/,
    /^\/api\/v1\/account\/export$/,
    /^\/api\/v1\/activities$/,
    new RegExp(`^/api/v1/published/${uuid}$`, "i"),
    new RegExp(`^/api/v1/decks$`, "i"),
    new RegExp(`^/api/v1/decks/mine$`, "i"),
    new RegExp(`^/api/v1/decks/${uuid}$`, "i"),
    new RegExp(`^/api/v1/decks/${uuid}/feedback$`, "i"),
    /^\/api\/v1\/deck-subscriptions$/,
    /^\/api\/v1\/deck-subscriptions\/updates$/,
  ],
  POST: [
    /^\/api\/v1\/workspace$/,
    /^\/api\/v1\/workspace\/study$/,
    /^\/api\/v1\/sync$/,
    /^\/api\/v1\/workspace\/(?:area-tombstones|review-identities)$/,
    /^\/api\/v1\/tutor$/,
    /^\/api\/v1\/account\/delete$/,
    /^\/api\/v1\/knowledge-areas$/,
    new RegExp(`^/api/v1/published/${uuid}/fork$`, "i"),
    /^\/api\/v1\/activities(?:\/(?:assess|question))?$/,
    new RegExp(`^/api/v1/deck-subscriptions/${uuid}/updates/read$`, "i"),
    new RegExp(`^/api/v1/decks/${uuid}/feedback$`, "i"),
    new RegExp(`^/api/v1/decks/${uuid}/reports$`, "i"),
    new RegExp(`^/api/v1/decks/${uuid}/block$`, "i"),
  ],
  PUT: [/^\/api\/v1\/deck-subscriptions$/],
  PATCH: [
    /^\/api\/v1\/tutor$/,
    new RegExp(`^/api/v1/published/${uuid}/token$`, "i"),
    new RegExp(`^/api/v1/decks/${uuid}$`, "i"),
    new RegExp(`^/api/v1/decks/${uuid}/feedback/${uuid}$`, "i"),
  ],
  DELETE: [
    /^\/api\/v1\/tutor\/privacy$/,
    new RegExp(`^/api/v1/deck-subscriptions/${uuid}$`, "i"),
    new RegExp(`^/api/v1/decks/${uuid}/block$`, "i"),
  ],
};

function validDeckListQuery(params: URLSearchParams): boolean {
  const allowed = new Set([
    "q",
    "language",
    "tag",
    "difficulty",
    "activityType",
    "minMinutes",
    "maxMinutes",
    "limit",
    "cursor",
  ]);
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (!allowed.has(key) || seen.has(key)) return false;
    seen.add(key);
    if (key === "q" && value.length > 200) return false;
    if (key === "language" && value.length > 40) return false;
    if (key === "tag" && value.length > 80) return false;
    if (key === "difficulty" && !["beginner", "intermediate", "advanced"].includes(value))
      return false;
    if (
      key === "activityType" &&
      (value.length < 1 ||
        value.length > 200 ||
        value !== value.trim() ||
        value !== value.toLowerCase())
    )
      return false;
    if ((key === "minMinutes" || key === "maxMinutes") && !/^[1-9]\d{0,3}$/.test(value))
      return false;
    if (key === "limit" && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(value)) return false;
    if (key === "cursor" && !id.test(value)) return false;
  }
  const minMinutes = params.get("minMinutes");
  const maxMinutes = params.get("maxMinutes");
  if (minMinutes && Number(minMinutes) > 1000) return false;
  if (maxMinutes && Number(maxMinutes) > 1000) return false;
  if (minMinutes && maxMinutes && Number(minMinutes) > Number(maxMinutes)) return false;
  return true;
}

function validPublishedQuery(pathname: string, params: URLSearchParams): boolean {
  const isUpdates = /^\/api\/v1\/published\/[0-9a-f-]{36}\/updates$/i.test(pathname);
  const allowed = isUpdates ? new Set(["sourceAreaId", "token"]) : new Set(["token"]);
  const seen = new Set<string>();
  for (const [key, value] of params) {
    if (!allowed.has(key) || seen.has(key)) return false;
    seen.add(key);
    if (key === "sourceAreaId" && !id.test(value)) return false;
    if (key === "token" && !new RegExp(`^${token}$`).test(value)) return false;
  }
  if (!isUpdates && seen.size > 0 && !seen.has("token")) return false;
  return true;
}

/** Narrow IPC allowlist for app API calls. Query fields are validated per route. */
export function isDesktopApiPathAllowed(method: DesktopApiMethod, value: string): boolean {
  if (value.length > 512 || value.includes("#") || /%(?![0-9a-f]{2})/i.test(value)) return false;
  const queryAt = value.indexOf("?");
  const pathname = queryAt < 0 ? value : value.slice(0, queryAt);
  const query = queryAt < 0 ? "" : value.slice(queryAt + 1);
  if (!routes[method].some((route) => route.test(pathname))) return false;
  if (!query) return queryAt < 0;

  const params = new URLSearchParams(query);
  if ([...params].length === 0) return false;
  if (pathname === "/api/v1/sync") {
    return (
      [...params].length === 1 &&
      params.getAll("cursor").length === 1 &&
      /^\d{1,20}$/.test(params.get("cursor") ?? "")
    );
  }
  if (pathname === "/api/v1/tutor") {
    return (
      [...params].length === 1 &&
      params.getAll("sessionId").length === 1 &&
      id.test(params.get("sessionId") ?? "")
    );
  }
  if (pathname === "/api/v1/decks") return validDeckListQuery(params);
  if (pathname === "/api/v1/decks/mine") {
    const allowed = new Set(["limit", "cursor"]);
    const seen = new Set<string>();
    for (const [key, entry] of params) {
      if (!allowed.has(key) || seen.has(key)) return false;
      seen.add(key);
      if (key === "limit" && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(entry)) return false;
      if (key === "cursor" && !id.test(entry)) return false;
    }
    return true;
  }
  if (/^\/api\/v1\/decks\/[0-9a-f-]{36}$/i.test(pathname)) {
    return (
      [...params].length === 1 &&
      params.getAll("token").length === 1 &&
      new RegExp(`^${token}$`).test(params.get("token") ?? "")
    );
  }
  if (/^\/api\/v1\/published\/[0-9a-f-]{36}(?:\/updates)?$/i.test(pathname))
    return validPublishedQuery(pathname, params);
  return false;
}
