const { build } = require("../package.json");
const updateUrl = process.env.RECALL_DESKTOP_UPDATE_URL?.trim();
const publisher = process.env.RECALL_DESKTOP_UPDATE_PUBLISHER?.trim();

function fail(message) {
  console.error(message);
  process.exit(1);
}
if (updateUrl) {
  if (!process.argv.includes("-c.forceCodeSigning=true"))
    fail("Automatic updates may only be enabled on signed release builds");
  if (!URL.canParse(updateUrl)) fail("Desktop updates require a valid HTTPS feed");
  const url = new URL(updateUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    fail("Desktop updates require an HTTPS feed without credentials, query or fragment");
  if (process.platform === "win32" && !publisher)
    fail("Desktop updates require the Windows signing certificate publisher subject");
}
module.exports = {
  ...build,
  ...(updateUrl ? { publish: { provider: "generic", url: updateUrl } } : {}),
  win: { ...build.win, ...(publisher ? { publisherName: publisher } : {}) },
};
