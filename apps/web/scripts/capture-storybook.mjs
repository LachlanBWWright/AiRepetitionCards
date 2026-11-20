import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { requestedStories as requestedStories1 } from "./capture-storybook-catalog-01.mjs";
import { requestedStories as requestedStories2 } from "./capture-storybook-catalog-02.mjs";
import { requestedStories as requestedStories3 } from "./capture-storybook-catalog-03.mjs";
import { requestedStories as requestedStories4 } from "./capture-storybook-catalog-04.mjs";
import { requestedStories as requestedStories5 } from "./capture-storybook-catalog-05.mjs";
import { requestedStories as requestedStories6 } from "./capture-storybook-catalog-06.mjs";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputGroup = process.env.RECALL_SCREENSHOT_GROUP ?? "storybook-screenshots";
if (!/^[a-z0-9][a-z0-9/-]*$/.test(outputGroup)) {
  process.stderr.write(
    "Screenshot group must be a relative artifact folder using letters, digits, dashes and slashes.\n",
  );
  process.exit(1);
}
const outputDir = path.resolve(appRoot, "../../artifacts", outputGroup);
const port = Number(process.env.STORYBOOK_PORT ?? 6006);
const baseUrl = process.env.RECALL_STORYBOOK_URL ?? `http://127.0.0.1:${port}`;
const requestedIds = new Set(
  (process.env.RECALL_SCREENSHOT_STORIES ?? "").split(",").filter(Boolean),
);
const requested = [
  requestedStories1,
  requestedStories2,
  requestedStories3,
  requestedStories4,
  requestedStories5,
  requestedStories6,
].flat();

async function waitForScreenState(page, shot) {
  if (shot.title === "Screens/Native App Shell") {
    const tab =
      shot.name.includes("account") || shot.name.includes("Account")
        ? "account"
        : shot.name.includes("tutor") || shot.name.includes("Tutor")
          ? "tutor"
          : shot.name.includes("sharing") || shot.name.includes("Sharing")
            ? "publishing"
            : shot.name.includes("Library") || shot.name.includes("attachments")
              ? "workspace-authoring"
              : null;
    const content = tab ? `[data-testid="native-${tab}-panel"]` : '[data-testid="mobile-screen"]';
    await page
      .locator(
        tab === "workspace-authoring" ? '[data-testid="native-workspace-authoring"]' : content,
      )
      .waitFor({ state: "visible", timeout: 20_000 });
  }
  if (shot.title !== "Screens/Native AI Tutor") return;
  const root = page.locator('[data-testid="native-tutor-panel"]');
  if (/proposal|throttled|limiter/.test(shot.name)) {
    const conversation = root.getByRole("button", { name: "Ask the tutor", exact: true });
    if (
      !(await root
        .getByRole("textbox", { name: "Proposed card question", exact: true })
        .isVisible()) &&
      (await conversation.count()) &&
      (await conversation.getAttribute("aria-expanded")) !== "true"
    )
      await conversation.click();
    await root
      .getByRole("textbox", { name: "Proposed card question", exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
  } else if (shot.name.includes("tentative")) {
    await root
      .getByText("This assessment is tentative. Ask for clarification or try another answer.", {
        exact: true,
      })
      .first()
      .waitFor({ state: "visible", timeout: 20_000 });
  } else if (shot.name.includes("weak quiz")) {
    await root
      .getByText("Your answer: DNA", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
  } else if (shot.name.includes("weak second objective")) {
    await root
      .getByText("Practice target: Gene expression", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
  }
}

let server;
let browser;

async function waitForStorybook() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server && server.exitCode !== null) {
      return { ok: false, message: `Storybook exited with code ${server.exitCode}` };
    }
    try {
      const response = await fetch(`${baseUrl}/index.json`);
      if (response.ok) return { ok: true, index: await response.json() };
    } catch {
      // Keep waiting while the local Storybook server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return { ok: false, message: `Storybook did not become ready at ${baseUrl}` };
}

let runError;

try {
  await rm(outputDir, { recursive: true, force: true });
  await mkdir(outputDir, { recursive: true });
  if (!process.env.RECALL_STORYBOOK_URL)
    server = spawn(
      process.execPath,
      [
        path.resolve(appRoot, "node_modules/storybook/dist/bin/dispatcher.js"),
        "dev",
        "--ci",
        "--no-open",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: appRoot,
        stdio: "inherit",
      },
    );

  const startup = await waitForStorybook();
  if (!startup.ok) {
    runError = startup.message;
  } else {
    const entries = Object.values(startup.index?.entries ?? {});
    browser = await chromium.launch({ headless: true });
    const indexedIds = new Set(
      entries.filter((entry) => entry.type === "story").map((entry) => entry.id),
    );
    const missingIds = [...requestedIds].filter((id) => !indexedIds.has(id));
    if (missingIds.length) runError = `Storybook IDs not found: ${missingIds.join(", ")}`;
    const requestedKeys = new Set(requested.map((shot) => `${shot.title}\0${shot.name}`));
    const additionalStories = entries
      .filter((entry) => entry.type === "story")
      .filter((entry) => !requestedKeys.has(`${entry.title}\0${entry.name}`))
      .sort(
        (left, right) =>
          left.title.localeCompare(right.title) || left.name.localeCompare(right.name),
      )
      .map((entry) => ({
        title: entry.title,
        name: entry.name,
        file: `${entry.id}.png`,
        viewport: /native|mobile/i.test(entry.title)
          ? { width: 390, height: 1000 }
          : { width: 1440, height: 1000 },
      }));
    const primaryShots = [...requested, ...additionalStories];
    const screenshots = primaryShots.flatMap((shot) => [
      shot,
      {
        ...shot,
        file: shot.file.replace(
          /\.png$/,
          shot.viewport.width < 720 ? "-desktop.png" : "-phone.png",
        ),
        viewport: { width: shot.viewport.width < 720 ? 1440 : 390, height: 1000 },
      },
    ]);
    const captureResults = [];
    const failedStories = [];

    for (const shot of screenshots) {
      const story = entries.find(
        (entry) => entry.type === "story" && entry.title === shot.title && entry.name === shot.name,
      );
      if (requestedIds.size > 0 && (!story || !requestedIds.has(story.id))) continue;
      if (!story) {
        failedStories.push(`${shot.title} · ${shot.name}: story not found in Storybook index`);
        continue;
      }

      const page = await browser.newPage({
        viewport: shot.viewport,
        deviceScaleFactor: 1,
        reducedMotion: "reduce",
        colorScheme: "light",
      });
      const renderErrors = [];
      page.on("pageerror", (error) => renderErrors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error") renderErrors.push(message.text());
      });
      let captureError;
      try {
        await page.goto(`${baseUrl}/iframe.html?id=${story.id}&viewMode=story`, {
          waitUntil: "networkidle",
        });
        await page.waitForFunction(
          () => {
            const root = document.querySelector("#storybook-root");
            return (
              (document.body.classList.contains("sb-show-main") ||
                document.body.classList.contains("sb-show-errordisplay")) &&
              (root?.childElementCount ||
                document.querySelector('[role="dialog"], .sb-errordisplay'))
            );
          },
          undefined,
          { timeout: 10_000 },
        );
        await waitForScreenState(page, shot);
        await page.evaluate(() => document.fonts.ready);
        const storyError = await page.evaluate(() =>
          document.body.classList.contains("sb-show-errordisplay")
            ? document.querySelector(".sb-errordisplay")?.textContent
            : null,
        );
        if (storyError) captureError = storyError.trim().slice(0, 1000);
        if (shot.title === "Screens/Recall Dashboard" && shot.viewport.width < 720) {
          await page.addStyleTag({
            content: ".mobile-footer { position: static !important; inset: auto !important; }",
          });
        }
        await page.waitForTimeout(200);
      } catch (error) {
        captureError = error instanceof Error ? error.message : String(error);
      }
      const criticalRenderErrors = renderErrors.filter((message) =>
        /SyntaxError|TypeError|ReferenceError|Failed to fetch|Failed to load/i.test(message),
      );
      if (captureError || criticalRenderErrors.length > 0) {
        const details = [...new Set(criticalRenderErrors)].slice(0, 3).join(" | ");
        failedStories.push(
          `${shot.title} · ${shot.name}: ${captureError ?? "browser reported a render error"}${details ? ` · ${details}` : ""}`,
        );
      }
      await page.screenshot({
        path: path.join(outputDir, shot.file),
        fullPage: true,
        animations: "disabled",
      });
      const dimensions = await page.evaluate(() => ({
        contentWidth: document.documentElement.scrollWidth,
        contentHeight: document.documentElement.scrollHeight,
      }));
      captureResults.push({
        storyId: story.id,
        title: shot.title,
        name: shot.name,
        file: shot.file,
        viewport: shot.viewport,
        ...dimensions,
        horizontalOverflow: dimensions.contentWidth > shot.viewport.width,
        errors: [...(captureError ? [captureError] : []), ...criticalRenderErrors],
      });
      await page.close();
      console.log(
        `Saved ${path.relative(path.resolve(appRoot, "../.."), path.join(outputDir, shot.file))}`,
      );
    }

    {
      await writeFile(
        path.join(outputDir, "manifest.json"),
        JSON.stringify(captureResults, null, 2),
      );
      const screenshotList = captureResults
        .map((shot) => `- [${shot.title} · ${shot.name}](./${shot.file})`)
        .join("\n");
      const failureList = failedStories.length
        ? `\n## Stories with render errors\n\n${failedStories.map((failure) => `- ${failure}`).join("\n")}\n`
        : "\nAll stories rendered without browser errors.\n";
      await writeFile(
        path.join(outputDir, "README.md"),
        `# Storybook screenshots\n\nGenerated ${captureResults.length} screenshots across desktop and phone widths from selected Storybook stories with deterministic mock data. See manifest.json for viewport dimensions, overflow and render diagnostics. Rebuild them with \`pnpm screenshots\` from the repository root.\n\n${screenshotList}\n${failureList}`,
      );
      if (failedStories.length > 0) {
        runError = `${failedStories.length} of ${captureResults.length} Storybook captures reported render errors. See ${path.relative(path.resolve(appRoot, "../.."), path.join(outputDir, "README.md"))}.`;
      }
    }
  }
} catch (error) {
  runError = error instanceof Error ? error.message : "Storybook screenshot capture failed";
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        server?.kill("SIGKILL");
        resolve();
      }, 5_000);
      server?.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
}

if (runError) {
  process.stderr.write(`${runError}\n`);
  process.exitCode = 1;
}
