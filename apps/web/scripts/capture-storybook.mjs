import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.resolve(appRoot, "../../artifacts/storybook-screenshots");
const port = Number(process.env.STORYBOOK_PORT ?? 6006);
const baseUrl = `http://127.0.0.1:${port}`;
const requested = [
  {
    title: "Screens/Mobile Client",
    name: "Today · offline study (native)",
    file: "mobile-today-offline.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Study · answer revealed (native)",
    file: "mobile-study-answer-revealed.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Study · card with media (native)",
    file: "mobile-study-card-with-media.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Mobile Client",
    name: "Study · caught up (native)",
    file: "mobile-study-caught-up.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Account",
    name: "Account · export data",
    file: "account-export.png",
    viewport: { width: 1440, height: 900 },
  },
  {
    title: "Screens/Account",
    name: "Account · delete confirmation",
    file: "account-delete-confirmation.png",
    viewport: { width: 1440, height: 900 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · desktop",
    file: "today-desktop.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · mobile",
    file: "today-mobile.png",
    viewport: { width: 390, height: 844 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Study · answer revealed",
    file: "study-answer-revealed.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Study · card with media",
    file: "study-card-with-media.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Study · caught up",
    file: "study-caught-up.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Explore · learning areas",
    file: "explore-learning-areas.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · edit learning area",
    file: "area-edit-dialog.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Library · add card with media",
    file: "card-add-media.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Insights · practice summary",
    file: "insights-practice-summary.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Insights · review sync conflict",
    file: "sync-conflict-review.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Recall Dashboard",
    name: "Today · empty library",
    file: "today-empty-library.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Design System/Button",
    name: "Full-screen · action catalog",
    file: "components-action-catalog.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Design System/Feedback",
    name: "Full-screen · feedback catalog",
    file: "components-feedback-catalog.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Design System/Review Card",
    name: "Full-screen · study card catalog",
    file: "components-study-card-catalog.png",
    viewport: { width: 1440, height: 1200 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · start",
    file: "tutor-start.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · answer feedback",
    file: "tutor-answer-feedback.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · card proposal",
    file: "tutor-card-proposal.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · objective gaps",
    file: "tutor-objective-gaps.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · targeted quiz",
    file: "tutor-targeted-quiz.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · targeted quiz feedback",
    file: "tutor-targeted-quiz-feedback.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/AI Tutor",
    name: "Tutor · daily limit reached",
    file: "tutor-daily-limit.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · publish area",
    file: "share-publish-area.png",
    viewport: { width: 1440, height: 1000 },
  },
  {
    title: "Screens/Knowledge Area Sharing",
    name: "Share · review attribution and license",
    file: "share-review-attribution-license.png",
    viewport: { width: 1440, height: 1000 },
  },
];

let server;
let browser;

async function waitForStorybook() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Storybook exited with code ${server.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/index.json`);
      if (response.ok) return response.json();
    } catch {
      // Keep waiting while the local Storybook server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Storybook did not become ready at ${baseUrl}`);
}

try {
  await mkdir(outputDir, { recursive: true });
  server = spawn(
    process.execPath,
    [
      path.resolve(appRoot, "node_modules/storybook/dist/bin/dispatcher.js"),
      "dev",
      "--ci",
      "--no-open",
      "--port",
      String(port),
    ],
    {
      cwd: appRoot,
      stdio: "inherit",
    },
  );

  const index = await waitForStorybook();
  const entries = Object.values(index.entries ?? {});
  browser = await chromium.launch({ headless: true });

  for (const shot of requested) {
    const story = entries.find(
      (entry) => entry.type === "story" && entry.title === shot.title && entry.name === shot.name,
    );
    if (!story) throw new Error(`Story not found: ${shot.name}`);

    const page = await browser.newPage({
      viewport: shot.viewport,
      deviceScaleFactor: 1,
      reducedMotion: "reduce",
      colorScheme: "light",
    });
    await page.goto(`${baseUrl}/iframe.html?id=${story.id}&viewMode=story`, {
      waitUntil: "networkidle",
    });
    const screenSelector =
      shot.title === "Screens/Recall Dashboard"
        ? ".app-shell"
        : shot.title === "Screens/Mobile Client"
          ? '[data-testid="mobile-screen"]'
          : shot.title === "Screens/Knowledge Area Sharing"
            ? ".publication-panel"
            : ".component-catalog";
    await page.locator(screenSelector).waitFor({ state: "visible", timeout: 20_000 });
    if (shot.title === "Screens/Recall Dashboard" && shot.viewport.width < 720) {
      await page.addStyleTag({
        content: ".mobile-footer { position: static !important; inset: auto !important; }",
      });
    }
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(outputDir, shot.file),
      fullPage: true,
      animations: "disabled",
    });
    await page.close();
    console.log(
      `Saved ${path.relative(path.resolve(appRoot, "../.."), path.join(outputDir, shot.file))}`,
    );
  }

  const screenshotList = requested.map((shot) => `- [${shot.name}](./${shot.file})`).join("\n");
  await writeFile(
    path.join(outputDir, "README.md"),
    `# Storybook screenshots\n\nGenerated from full-screen Storybook stories with deterministic mock data. Rebuild them with \`pnpm screenshots\` from the repository root.\n\n${screenshotList}\n`,
  );
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
