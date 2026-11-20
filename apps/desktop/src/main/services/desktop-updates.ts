import { app, dialog } from "electron";
import updater from "electron-updater";
import { Effect, Option } from "effect";
import { join } from "node:path";
import { backup, type DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { runDesktopUpdate, type UpdateStage } from "./update-workflow";

function operation<A>(stage: UpdateStage, work: () => Promise<A>) {
  return Effect.tryPromise({
    try: work,
    catch: () => ({ _tag: "DesktopUpdateFailure", stage }) as const,
  });
}
function updatePorts(database: DatabaseSync) {
  const { autoUpdater } = updater;
  return {
    check: operation("check", async () => {
      const result = await autoUpdater.checkForUpdates();
      return result?.isUpdateAvailable ? result.updateInfo.version : null;
    }).pipe(Effect.timeoutOption("5 seconds"), Effect.map(Option.getOrNull)),
    consentDownload: (version: string) =>
      operation("prompt", async () => {
        const consent = await dialog.showMessageBox({
          type: "info",
          title: "Recall update available",
          message: `Recall ${version} is available.`,
          detail: "Download the signed update before opening Recall?",
          buttons: ["Download update", "Later"],
          defaultId: 1,
          cancelId: 1,
        });
        return consent.response === 0;
      }),
    download: operation("download", async () => {
      await autoUpdater.downloadUpdate();
    }),
    consentRestart: operation("prompt", async () => {
      const install = await dialog.showMessageBox({
        type: "info",
        title: "Recall update ready",
        message: "The signed update is ready to install.",
        detail:
          "A recovery copy of your local collection and media will be saved before installation.",
        buttons: ["Install update", "Open Recall"],
        defaultId: 1,
        cancelId: 1,
      });
      return install.response === 0;
    }),
    backup: operation("backup", async () => {
      const directory = join(app.getPath("userData"), "upgrade-backups");
      await mkdir(directory, { recursive: true });
      await backup(database, join(directory, `before-install-${randomUUID()}.sqlite`));
    }),
    install: Effect.try({
      try: () => {
        autoUpdater.quitAndInstall(false, true);
      },
      catch: () => ({ _tag: "DesktopUpdateFailure", stage: "install" }) as const,
    }),
  };
}

/** Run before opening a renderer: installation can never interrupt a review or unsaved editor. */
export function prepareDesktopUpdates(database: DatabaseSync): Effect.Effect<boolean> {
  const feed = process.env.RECALL_DESKTOP_UPDATE_URL;
  if (!app.isPackaged || !["darwin", "win32"].includes(process.platform) || !feed)
    return Effect.succeed(false);
  if (!URL.canParse(feed)) return Effect.succeed(false);
  const url = new URL(feed);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    return Effect.succeed(false);
  const { autoUpdater } = updater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.setFeedURL({ provider: "generic", url: feed });
  // The updater emits a rejected operation as an event too. Handle both channels.
  autoUpdater.on("error", () => undefined);
  return runDesktopUpdate(updatePorts(database)).pipe(
    Effect.catchAll((failure) => {
      if (failure.stage === "check") return Effect.succeed(false);
      return operation("prompt", () =>
        dialog.showMessageBox({
          type: "warning",
          title: "Recall update postponed",
          message: "The update could not finish safely. Your current installation is unchanged.",
          detail:
            "Recall will check again next time it starts. Check disk space and your network connection.",
        }),
      ).pipe(Effect.ignore, Effect.as(false));
    }),
  );
}
