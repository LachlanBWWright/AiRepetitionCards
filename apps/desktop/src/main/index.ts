import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  session,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import { Effect, Either, Schema } from "effect";
import { desktopSecretStoreOverride } from "./security/desktop-secure-storage";
import { isRendererDocument } from "./renderer-document";
import { registerDesktopServices } from "./services/desktop-services";
import { registerDesktopMediaIpc } from "./ipc/desktop-media-ipc";
import { registerDesktopAnkiIpc } from "./ipc/anki-ipc";
import { registerBackupIpc } from "./ipc/backup-ipc";
import { registerChatGptLocal } from "./chatgpt/chatgpt-local";
import { registerDailyReminders } from "./daily-reminders";
import { registerWorkspaceIpc } from "./ipc/index-workspace-ipc";

// Choose the OS keyring before Electron initializes Chromium's encryption backend.
const secretStore = desktopSecretStoreOverride(
  process.platform,
  app.commandLine.hasSwitch("password-store"),
  process.env.XDG_CURRENT_DESKTOP,
  process.env.DESKTOP_SESSION,
);
if (secretStore) app.commandLine.appendSwitch("password-store", secretStore);

// One process owns rotating credentials and SQLite for this user-data directory.
const ownsInstanceLock = app.requestSingleInstanceLock();
if (!ownsInstanceLock) app.quit();

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow: BrowserWindow | null = null;
const mainDirectory = fileURLToPath(new URL(".", import.meta.url));
const rendererDirectory = join(mainDirectory, "../renderer/");
let authServices: ReturnType<typeof registerDesktopServices> | null = null;
let pendingAuthUrl: string | null = null;

function configureContentSecurityPolicy(): void {
  const policy = rendererUrl
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:5173 ws://localhost:5173 https://*.supabase.co; img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'"
    : "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co; img-src 'self' data: blob:; media-src 'self' data: blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'";
  const localAssetPrefix = rendererUrl ?? pathToFileURL(rendererDirectory).href;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url.startsWith(localAssetPrefix)) {
      callback(details.responseHeaders ? { responseHeaders: details.responseHeaders } : {});
      return;
    }
    const headers = Object.fromEntries(
      Object.entries(details.responseHeaders ?? {}).filter(
        ([name]) => name.toLowerCase() !== "content-security-policy",
      ),
    );
    callback({
      responseHeaders: { ...headers, "Content-Security-Policy": [policy] },
    });
  });
}

function trustedClipboardFrame(
  contents: WebContents | null,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
  requestingOrigin?: string,
): boolean {
  const expectedUrl = rendererUrl ?? pathToFileURL(join(rendererDirectory, "index.html")).href;
  if (
    !mainWindow ||
    !contents ||
    contents !== mainWindow.webContents ||
    !isMainFrame ||
    !isRendererDocument(requestingUrl, expectedUrl) ||
    !isRendererDocument(contents.mainFrame.url, expectedUrl)
  )
    return false;
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => new URL(expectedUrl),
        catch: () => ({ _tag: "InvalidRendererOrigin" }) as const,
      }),
    ),
  );
  if (Either.isLeft(parsed)) return false;
  if (requestingOrigin === undefined) return true;
  return parsed.right.protocol === "file:"
    ? requestingOrigin === "file://" || requestingOrigin === "null"
    : requestingOrigin === parsed.right.origin;
}

function configureSessionPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(
      permission === "clipboard-sanitized-write" &&
        trustedClipboardFrame(contents, details.requestingUrl, details.isMainFrame),
    );
  });
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, origin, details) =>
      permission === "clipboard-sanitized-write" &&
      trustedClipboardFrame(contents, details.requestingUrl, details.isMainFrame, origin),
  );
}

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || !mainWindow || frame !== mainWindow.webContents.mainFrame) return false;
  const expectedUrl = rendererUrl ?? pathToFileURL(join(rendererDirectory, "index.html")).href;
  return isRendererDocument(frame.url, expectedUrl);
}

function openDatabase(): Effect.Effect<DatabaseSync, { readonly _tag: "DatabaseOpenFailure" }> {
  return Effect.try({
    try: () => {
      const databasePath = join(app.getPath("userData"), "recall.sqlite");
      mkdirSync(dirname(databasePath), { recursive: true });
      const database = new DatabaseSync(databasePath);
      database.exec("PRAGMA journal_mode = WAL");
      database.exec(`
        CREATE TABLE IF NOT EXISTS local_workspace (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          serialized_workspace TEXT NOT NULL,
          updated_at TEXT NOT NULL
        ) STRICT
      `);
      database.exec(`
        CREATE TABLE IF NOT EXISTS secure_credentials (
          name TEXT PRIMARY KEY NOT NULL,
          encrypted_value TEXT NOT NULL
        ) STRICT
      `);
      database.exec(`
        CREATE TABLE IF NOT EXISTS media_assets (
          id TEXT PRIMARY KEY NOT NULL,
          reference_json TEXT NOT NULL,
          bytes BLOB NOT NULL
        ) STRICT
      `);
      return database;
    },
    catch: () => ({ _tag: "DatabaseOpenFailure" }) as const,
  });
}

const SharedLinkSchema = Schema.Struct({
  versionId: Schema.String.pipe(
    Schema.pattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  ),
  token: Schema.optional(Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{43}$/))),
});

/** Only explicit shared-page links at the configured application origin may leave the renderer. */
function validatedSharedLink(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048 || !process.env.RECALL_API_URL) return null;
  const parsed = Effect.runSync(
    Effect.either(
      Effect.try({
        try: () => ({ base: new URL(process.env.RECALL_API_URL ?? ""), target: new URL(value) }),
        catch: () => ({ _tag: "InvalidSharedLink" }) as const,
      }),
    ),
  );
  if (Either.isLeft(parsed)) return null;
  const { base, target } = parsed.right;
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !(base.protocol === "http:" && loopback)) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    target.origin !== base.origin ||
    target.username ||
    target.password ||
    target.hash
  )
    return null;
  const match = /^\/shared\/([^/]+)$/.exec(target.pathname);
  const tokens = target.searchParams.getAll("token");
  if (!match || tokens.length > 1 || [...target.searchParams.keys()].some((key) => key !== "token"))
    return null;
  const validated = Schema.decodeUnknownEither(SharedLinkSchema)({
    versionId: match[1],
    ...(tokens[0] === undefined ? {} : { token: tokens[0] }),
  });
  return Either.isRight(validated) ? target.href : null;
}

const chatGptSettingsLinks = new Set([
  "https://chatgpt.com/settings/usage",
  "https://help.openai.com/",
]);

/** Only validated share links and these fixed ChatGPT support destinations leave the renderer. */
function openApprovedExternalLink(value: unknown): void {
  const url =
    typeof value === "string" && chatGptSettingsLinks.has(value)
      ? value
      : validatedSharedLink(value);
  if (url === null) return;
  void Effect.runPromise(
    Effect.tryPromise({
      try: () => shell.openExternal(url),
      catch: () => ({ _tag: "SharedLinkOpenFailed" }) as const,
    }).pipe(
      Effect.catchAll(() =>
        Effect.tryPromise({
          try: () => {
            const options = {
              type: "error" as const,
              title: "Link could not be opened",
              message: "Copy the link and open it in your browser.",
            };
            return mainWindow
              ? dialog.showMessageBox(mainWindow, options)
              : dialog.showMessageBox(options);
          },
          catch: () => ({ _tag: "SharedLinkNoticeFailed" }) as const,
        }).pipe(Effect.ignore),
      ),
      Effect.asVoid,
    ),
  );
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 680,
    webPreferences: {
      preload: join(mainDirectory, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    openApprovedExternalLink(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (
      !isRendererDocument(
        url,
        rendererUrl ?? pathToFileURL(join(rendererDirectory, "index.html")).href,
      )
    ) {
      event.preventDefault();
      openApprovedExternalLink(url);
    }
  });
  if (rendererUrl) void window.loadURL(rendererUrl);
  else void window.loadFile(join(mainDirectory, "../renderer/index.html"));
  return window;
}

function receiveAuthUrl(value: string): void {
  if (!value.startsWith("recall://auth/confirm")) return;
  if (!authServices) {
    pendingAuthUrl = value;
    return;
  }
  void authServices.handleAuthUrl(value).then((confirmed) => {
    mainWindow?.webContents.send("auth:callback", { confirmed });
  });
}

app.setAppUserModelId("com.recall.study");
app.setAsDefaultProtocolClient("recall");
app.on("open-url", (event, value) => {
  event.preventDefault();
  receiveAuthUrl(value);
});
app.on("second-instance", (_event, commandLine) => {
  const authUrl = commandLine.find((argument) => argument.startsWith("recall://auth/confirm"));
  if (authUrl) receiveAuthUrl(authUrl);
  mainWindow?.show();
});
const initialAuthUrl = process.argv.find((argument) =>
  argument.startsWith("recall://auth/confirm"),
);
if (initialAuthUrl) pendingAuthUrl = initialAuthUrl;

const ready = Effect.tryPromise({
  try: () => app.whenReady(),
  catch: () => ({ _tag: "ApplicationStartFailure" }) as const,
}).pipe(
  Effect.flatMap(() => openDatabase()),
  Effect.matchEffect({
    onFailure: () =>
      Effect.sync(() => {
        app.quit();
      }),
    onSuccess: (database) =>
      Effect.sync(() => {
        registerChatGptLocal(trustedSender);
        registerDesktopMediaIpc(database, trustedSender);
        registerDesktopAnkiIpc(trustedSender);
        registerBackupIpc(() => mainWindow, trustedSender);
        authServices = registerDesktopServices(
          database,
          () => mainWindow,
          trustedSender,
          process.env.RECALL_API_URL,
        );
        configureSessionPermissions();
        configureContentSecurityPolicy();
        if (process.platform !== "darwin") Menu.setApplicationMenu(null);
        mainWindow = createWindow();
        const reminders = registerDailyReminders(trustedSender, () => {
          if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.show();
          mainWindow.focus();
          const contents = mainWindow.webContents;
          const notify = () => {
            contents.send("reminders:open");
          };
          if (contents.isLoadingMainFrame()) contents.once("did-finish-load", notify);
          else notify();
        });
        registerWorkspaceIpc(database, trustedSender, reminders.clear);
        if (pendingAuthUrl) {
          const authUrl = pendingAuthUrl;
          pendingAuthUrl = null;
          receiveAuthUrl(authUrl);
        }
        app.on("activate", () => {
          if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow();
        });
        app.on("window-all-closed", () => {
          if (process.platform !== "darwin") app.quit();
        });
      }),
  }),
);

if (ownsInstanceLock) void Effect.runPromise(ready);
