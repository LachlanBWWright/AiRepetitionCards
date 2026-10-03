import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { Effect, Either, Schema } from "effect";
import { parseWorkspaceJson } from "@recall/domain";
import type { Workspace } from "@recall/domain";
import { registerDesktopServices } from "./desktop-services";
import { registerDesktopMediaIpc } from "./desktop-media-ipc";

const WorkspaceWriteLimit = 5_000_000;
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
let mainWindow: BrowserWindow | null = null;
const mainDirectory = fileURLToPath(new URL(".", import.meta.url));
const rendererDirectory = join(mainDirectory, "../renderer/");
let authServices: ReturnType<typeof registerDesktopServices> | null = null;
let pendingAuthUrl: string | null = null;

function configureContentSecurityPolicy(): void {
  const policy = rendererUrl
    ? "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173; style-src 'self' 'unsafe-inline'; connect-src 'self' http://localhost:5173 ws://localhost:5173 https://*.supabase.co; img-src 'self' data: blob:; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'"
    : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co; img-src 'self' data: blob:; media-src 'self' data: blob:; object-src 'none'; base-uri 'none'";
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

type DesktopReply<T> =
  { readonly _tag: "Success"; readonly value: T } | { readonly _tag: "Failure" };

function failure<T>(): DesktopReply<T> {
  return { _tag: "Failure" };
}

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || !mainWindow || frame !== mainWindow.webContents.mainFrame) return false;
  const frameUrl = frame.url;
  return rendererUrl ? frameUrl === rendererUrl : frameUrl === mainWindow.webContents.getURL();
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

function registerWorkspaceIpc(database: DatabaseSync): void {
  ipcMain.handle("workspace:read", (event): DesktopReply<string | null> => {
    if (!trustedSender(event)) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            const row: unknown = database
              .prepare("SELECT serialized_workspace FROM local_workspace WHERE id = 1")
              .get();
            if (
              typeof row === "object" &&
              row !== null &&
              "serialized_workspace" in row &&
              typeof row.serialized_workspace === "string"
            ) {
              return row.serialized_workspace;
            }
            return null;
          },
          catch: () => ({ _tag: "WorkspaceReadFailure" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? { _tag: "Success", value: result.right } : failure();
  });

  ipcMain.handle("workspace:write", async (event, input: unknown): Promise<DesktopReply<void>> => {
    if (!trustedSender(event)) return failure();
    const serialized = Schema.decodeUnknownEither(Schema.String)(input);
    if (
      Either.isLeft(serialized) ||
      Buffer.byteLength(serialized.right, "utf8") > WorkspaceWriteLimit
    ) {
      return failure();
    }
    const decoded = await Effect.runPromise(Effect.either(parseWorkspaceJson(serialized.right)));
    if (Either.isLeft(decoded)) return failure();
    const write = Effect.try({
      try: () => {
        database
          .prepare(
            `INSERT INTO local_workspace (id, serialized_workspace, updated_at)
               VALUES (1, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 serialized_workspace = excluded.serialized_workspace,
                 updated_at = excluded.updated_at`,
          )
          .run(JSON.stringify(decoded.right satisfies Workspace), new Date().toISOString());
      },
      catch: () => ({ _tag: "WorkspaceWriteFailure" }) as const,
    });
    return Either.isRight(Effect.runSync(Effect.either(write)))
      ? { _tag: "Success", value: undefined }
      : failure();
  });

  ipcMain.handle("workspace:clear", (event): DesktopReply<void> => {
    if (!trustedSender(event)) return failure();
    const result = Effect.runSync(
      Effect.either(
        Effect.try({
          try: () => {
            database.prepare("DELETE FROM local_workspace WHERE id = 1").run();
          },
          catch: () => ({ _tag: "WorkspaceClearFailure" }) as const,
        }),
      ),
    );
    return Either.isRight(result) ? { _tag: "Success", value: undefined } : failure();
  });
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
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (rendererUrl && url !== rendererUrl) event.preventDefault();
    if (!rendererUrl && url !== window.webContents.getURL()) event.preventDefault();
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
    onFailure: () => Effect.sync(() => app.quit()),
    onSuccess: (database) =>
      Effect.sync(() => {
        registerWorkspaceIpc(database);
        registerDesktopMediaIpc(database, trustedSender);
        authServices = registerDesktopServices(
          database,
          () => mainWindow,
          trustedSender,
          process.env.RECALL_API_URL,
        );
        configureContentSecurityPolicy();
        mainWindow = createWindow();
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

void Effect.runPromise(ready);
