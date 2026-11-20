import { readdir, readFile, readlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
if (process.platform !== "linux") {
  process.stderr.write(
    "This diagnostic reads Linux /proc. Use your OS process monitor on other platforms.\n",
  );
  process.exitCode = 1;
} else {
  const rows = [];
  for (const name of await readdir("/proc")) {
    if (!/^\d+$/.test(name) || Number(name) === process.pid) continue;
    try {
      const directory = join("/proc", name);
      const command = (await readFile(join(directory, "cmdline"), "utf8")).replaceAll("\0", " ");
      const status = await readFile(join(directory, "status"), "utf8");
      const cwd = await readlink(join(directory, "cwd"));
      const executable = basename(await readlink(join(directory, "exe")));
      if (!/^(node|pnpm|next-server|next-build)/.test(executable)) continue;
      if (cwd !== root && !cwd.startsWith(root + "/") && !command.includes(root + "/")) continue;
      const tool =
        ["storybook", "next", "eslint", "typescript", "expo", "turbo", "pnpm"].find((candidate) =>
          command.includes(candidate),
        ) ?? "node";
      rows.push({
        pid: Number(name),
        tool,
        rss: Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0),
        swap: Number(/^VmSwap:\s+(\d+)/m.exec(status)?.[1] ?? 0),
      });
    } catch {
      // A process may exit or deny access while the snapshot is being collected.
    }
  }
  rows.sort((a, b) => b.rss + b.swap - a.rss - a.swap);
  process.stdout.write("PID       Tool          RSS MiB   Swap MiB\n");
  for (const row of rows)
    process.stdout.write(
      `${String(row.pid).padEnd(10)}${row.tool.padEnd(14)}${(row.rss / 1024).toFixed(0).padStart(7)}${(row.swap / 1024).toFixed(0).padStart(11)}\n`,
    );
  process.stdout.write(
    `Total: ${(rows.reduce((sum, row) => sum + row.rss, 0) / 1024).toFixed(0)} MiB RSS, ${(rows.reduce((sum, row) => sum + row.swap, 0) / 1024).toFixed(0)} MiB swap.\n`,
  );
  process.stdout.write(
    "RSS includes shared pages; swap is reported separately. Browser and native compiler memory are excluded.\n",
  );
}
