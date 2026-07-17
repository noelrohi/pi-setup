import fs from "node:fs";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

const commandName = "diff";
const MAX_DIFF_LINES = 20_000;
const SCROLL_STEP = 5;

interface ChangedPath {
  absolutePath: string;
  relativePath: string;
}

interface FileDiff extends ChangedPath {
  additions: number;
  deletions: number;
  lines: string[];
}

function getStringPath(input: unknown) {
  if (!input || typeof input !== "object" || !("path" in input))
    return undefined;
  return typeof input.path === "string" ? input.path : undefined;
}

function toAbsolute(cwd: string, filePath: string) {
  const absolute = path.isAbsolute(filePath)
    ? path.normalize(filePath)
    : path.resolve(cwd, filePath);
  try {
    return fs.realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function toRelative(cwd: string, filePath: string) {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? relative
    : filePath;
}

function parseGitStatus(output: string, cwd: string) {
  const files = new Set<string>();

  for (const line of output.split("\n")) {
    if (line.length < 4) continue;

    const rawPath = line.slice(3).trim();
    if (!rawPath) continue;

    const targetPath = rawPath.includes(" -> ")
      ? rawPath.split(" -> ").at(-1)
      : rawPath;
    if (!targetPath) continue;

    files.add(toAbsolute(cwd, targetPath.replace(/^"|"$/g, "")));
  }

  return files;
}

async function getGitChangedFiles(pi: ExtensionAPI, cwd: string) {
  const repoRoot = await getRepoRoot(pi, cwd);
  if (!repoRoot) return new Set<string>();

  const result = await pi.exec(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: repoRoot, timeout: 5_000 },
  );

  if (result.code !== 0) return new Set<string>();
  return parseGitStatus(result.stdout, repoRoot);
}

function difference(current: Set<string>, baseline: Set<string>) {
  return new Set([...current].filter((file) => !baseline.has(file)));
}

async function getRepoRoot(pi: ExtensionAPI, cwd: string) {
  const result = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
    timeout: 5_000,
  });
  return result.code === 0 ? result.stdout.trim() : undefined;
}

function countChanges(lines: string[]) {
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }

  return { additions, deletions };
}

async function loadFileDiff(
  pi: ExtensionAPI,
  repoRoot: string,
  absolutePath: string,
  hasHead: boolean,
) {
  const relativePath = path.relative(repoRoot, absolutePath);
  const tracked = await pi.exec(
    "git",
    ["ls-files", "--error-unmatch", "--", relativePath],
    {
      cwd: repoRoot,
      timeout: 5_000,
    },
  );
  const args =
    hasHead && tracked.code === 0
      ? ["diff", "--no-ext-diff", "--no-color", "HEAD", "--", relativePath]
      : [
          "diff",
          "--no-index",
          "--no-ext-diff",
          "--no-color",
          "--",
          "/dev/null",
          relativePath,
        ];
  const result = await pi.exec("git", args, { cwd: repoRoot, timeout: 10_000 });
  const allLines = result.stdout.trimEnd().split("\n");
  const lines =
    allLines.length > MAX_DIFF_LINES
      ? [
          ...allLines.slice(0, MAX_DIFF_LINES),
          `… diff truncated after ${MAX_DIFF_LINES.toLocaleString()} lines …`,
        ]
      : allLines;
  const normalizedLines =
    lines.length === 1 && lines[0] === ""
      ? ["No textual diff available."]
      : lines;

  return {
    absolutePath,
    relativePath,
    lines: normalizedLines,
    ...countChanges(normalizedLines),
  } satisfies FileDiff;
}

async function loadDiffs(
  pi: ExtensionAPI,
  cwd: string,
  absolutePaths: Iterable<string>,
) {
  const repoRoot = await getRepoRoot(pi, cwd);
  if (!repoRoot) return undefined;

  const head = await pi.exec("git", ["rev-parse", "--verify", "HEAD"], {
    cwd: repoRoot,
    timeout: 5_000,
  });
  const paths = [...new Set(absolutePaths)]
    .filter((file) => {
      const relative = path.relative(repoRoot, file);
      return (
        relative !== "" &&
        !relative.startsWith("..") &&
        !path.isAbsolute(relative)
      );
    })
    .sort((a, b) =>
      toRelative(repoRoot, a).localeCompare(toRelative(repoRoot, b)),
    );

  return Promise.all(
    paths.map((file) => loadFileDiff(pi, repoRoot, file, head.code === 0)),
  );
}

function pad(text: string, width: number) {
  const truncated = truncateToWidth(text, width, "");
  return `${truncated}${" ".repeat(Math.max(0, width - visibleWidth(truncated)))}`;
}

function styleDiffLine(line: string, theme: ExtensionContext["ui"]["theme"]) {
  const expanded = line.replaceAll("\t", "    ");
  if (expanded.startsWith("diff --git") || expanded.startsWith("index ")) {
    return theme.fg("accent", theme.bold(expanded));
  }
  if (expanded.startsWith("@@")) return theme.fg("mdHeading", expanded);
  if (expanded.startsWith("---") || expanded.startsWith("+++")) {
    return theme.fg("muted", expanded);
  }
  if (expanded.startsWith("+")) return theme.fg("success", expanded);
  if (expanded.startsWith("-")) return theme.fg("error", expanded);
  if (expanded.startsWith("…")) return theme.fg("warning", expanded);
  return theme.fg("text", expanded);
}

async function showDiffViewer(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  files: FileDiff[],
  title: string,
) {
  if (!ctx.hasUI) {
    ctx.ui.notify("The diff viewer requires interactive mode", "warning");
    return;
  }

  await ctx.ui.custom<void>(
    (tui, theme, _keybindings, done) => {
      let focus: "files" | "diff" = "files";
      let selectedIndex = 0;
      let fileOffset = 0;
      let diffOffset = 0;

      const bodyHeight = () =>
        Math.max(8, Math.floor(tui.terminal.rows * 0.8) - 2);

      function ensureFileVisible() {
        const visibleFiles = Math.max(1, Math.floor(bodyHeight() / 2));
        if (selectedIndex < fileOffset) fileOffset = selectedIndex;
        if (selectedIndex >= fileOffset + visibleFiles) {
          fileOffset = selectedIndex - visibleFiles + 1;
        }
      }

      function moveFile(amount: number) {
        selectedIndex = (selectedIndex + amount + files.length) % files.length;
        diffOffset = 0;
        ensureFileVisible();
        tui.requestRender();
      }

      function moveDiff(amount: number) {
        const max = Math.max(
          0,
          files[selectedIndex]!.lines.length - bodyHeight(),
        );
        diffOffset = Math.max(0, Math.min(max, diffOffset + amount));
        tui.requestRender();
      }

      async function openSelected() {
        const selected = files[selectedIndex]!;
        const result = await pi.exec("zed", ["-e", selected.absolutePath], {
          cwd: ctx.cwd,
          timeout: 5_000,
        });
        if (result.code === 0) {
          ctx.ui.notify(`Opened ${selected.relativePath} in Zed`, "info");
        } else {
          ctx.ui.notify(
            result.stderr.trim() || `Failed to open ${selected.relativePath}`,
            "error",
          );
        }
      }

      function handleInput(data: string) {
        if (data === "o") {
          void openSelected();
          return;
        }
        if (focus === "files") {
          if (matchesKey(data, Key.escape)) return done(undefined);
          if (matchesKey(data, Key.down) || data === "j") return moveFile(1);
          if (matchesKey(data, Key.up) || data === "k") return moveFile(-1);
          if (matchesKey(data, Key.home) || data === "g") {
            selectedIndex = 0;
            diffOffset = 0;
            ensureFileVisible();
            tui.requestRender();
            return;
          }
          if (matchesKey(data, Key.end) || data === "G") {
            selectedIndex = files.length - 1;
            diffOffset = 0;
            ensureFileVisible();
            tui.requestRender();
            return;
          }
          if (
            matchesKey(data, Key.enter) ||
            matchesKey(data, Key.space) ||
            matchesKey(data, Key.right) ||
            data === "l"
          ) {
            focus = "diff";
            tui.requestRender();
          }
          return;
        }

        if (
          matchesKey(data, Key.escape) ||
          matchesKey(data, Key.left) ||
          data === "h"
        ) {
          focus = "files";
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.down) || data === "j")
          return moveDiff(SCROLL_STEP);
        if (matchesKey(data, Key.up) || data === "k")
          return moveDiff(-SCROLL_STEP);
        if (matchesKey(data, Key.ctrl("d")))
          return moveDiff(Math.max(1, Math.floor(bodyHeight() / 2)));
        if (matchesKey(data, Key.ctrl("u")))
          return moveDiff(-Math.max(1, Math.floor(bodyHeight() / 2)));
        if (matchesKey(data, Key.home) || data === "g") {
          diffOffset = 0;
          tui.requestRender();
          return;
        }
        if (matchesKey(data, Key.end) || data === "G") {
          diffOffset = Math.max(
            0,
            files[selectedIndex]!.lines.length - bodyHeight(),
          );
          tui.requestRender();
        }
      }

      function border(width: number, label: string, top: boolean) {
        const left = top ? "┌" : "└";
        const right = top ? "┐" : "┘";
        const content = `─ ${label} `;
        return theme.fg(
          "borderAccent",
          truncateToWidth(
            `${left}${content}${"─".repeat(Math.max(0, width - visibleWidth(content) - 2))}${right}`,
            width,
            "",
          ),
        );
      }

      function render(width: number) {
        const height = bodyHeight();
        const sidebarWidth = Math.min(
          48,
          Math.max(24, Math.floor(width * 0.34)),
        );
        const diffWidth = Math.max(1, width - sidebarWidth - 3);
        const selected = files[selectedIndex]!;
        const lines = [
          border(
            width,
            `${title} · ${files.length} files · ${focus.toUpperCase()}`,
            true,
          ),
        ];

        for (let row = 0; row < height; row += 1) {
          const fileIndex = fileOffset + Math.floor(row / 2);
          const file = files[fileIndex];
          let sidebar = "";

          if (file) {
            const isSelected = fileIndex === selectedIndex;
            if (row % 2 === 0) {
              const marker = isSelected ? "› " : "  ";
              const stats = `${theme.fg("success", `+${file.additions}`)} ${theme.fg("error", `-${file.deletions}`)}`;
              const name = truncateToWidth(
                path.basename(file.relativePath),
                Math.max(1, sidebarWidth - visibleWidth(stats) - 4),
                "…",
              );
              sidebar = `${marker}${name}${" ".repeat(Math.max(1, sidebarWidth - visibleWidth(marker) - visibleWidth(name) - visibleWidth(stats)))}${stats}`;
            } else {
              sidebar = `  ${theme.fg("dim", truncateToWidth(file.relativePath, Math.max(1, sidebarWidth - 2), "…"))}`;
            }
            sidebar = pad(sidebar, sidebarWidth);
            if (isSelected) {
              sidebar = theme.bg(
                focus === "files" ? "selectedBg" : "customMessageBg",
                sidebar,
              );
            }
          } else {
            sidebar = " ".repeat(sidebarWidth);
          }

          const diffLine = selected.lines[diffOffset + row];
          const renderedDiff = pad(
            diffLine === undefined ? "" : styleDiffLine(diffLine, theme),
            diffWidth,
          );
          const separator = theme.fg(
            focus === "diff" ? "borderAccent" : "borderMuted",
            "│",
          );
          lines.push(
            `${theme.fg("borderMuted", "│")}${sidebar}${separator}${renderedDiff}${theme.fg("borderMuted", "│")}`,
          );
        }

        const help =
          focus === "files"
            ? "j/k select · enter/l diff · o open in Zed · esc close"
            : "j/k scroll · ctrl-d/u page · g/G ends · o open · esc/h files";
        lines.push(border(width, help, false));
        return lines;
      }

      return { handleInput, invalidate() {}, render };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        margin: 1,
        maxHeight: "90%",
        minWidth: 60,
        width: "95%",
      },
    },
  );
}

export default function (pi: ExtensionAPI) {
  let gitBaseline = new Set<string>();
  let changedFiles = new Set<string>();
  let toolTouchedFiles = new Set<string>();

  pi.on("agent_start", async (_event, ctx) => {
    toolTouchedFiles = new Set();
    changedFiles = new Set();
    gitBaseline = await getGitChangedFiles(pi, ctx.cwd);
  });

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== "edit" && event.toolName !== "write") return;

    const filePath = getStringPath(event.input);
    if (filePath) toolTouchedFiles.add(toAbsolute(ctx.cwd, filePath));
  });

  pi.on("agent_end", async (_event, ctx) => {
    const gitChanged = await getGitChangedFiles(pi, ctx.cwd);
    changedFiles = new Set([
      ...difference(gitChanged, gitBaseline),
      ...toolTouchedFiles,
    ]);

    if (changedFiles.size > 0) {
      ctx.ui.notify(
        `${changedFiles.size} changed file(s). Run /${commandName} to review.`,
        "info",
      );
    }
  });

  pi.registerCommand(commandName, {
    description: "Review files changed by the last agent run",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      const arg = args.trim();

      if (arg === "clear") {
        changedFiles = new Set();
        toolTouchedFiles = new Set();
        gitBaseline = await getGitChangedFiles(pi, ctx.cwd);
        ctx.ui.notify("Cleared changed file list", "info");
        return;
      }

      const paths = [...changedFiles];
      if (paths.length === 0) {
        ctx.ui.notify(
          "No changed files tracked from the last agent run",
          "info",
        );
        return;
      }
      if (arg === "list") {
        ctx.ui.notify(
          `Changed files:\n${paths.map((file) => `- ${toRelative(ctx.cwd, file)}`).join("\n")}`,
          "info",
        );
        return;
      }
      if (arg) {
        ctx.ui.notify(
          `Unknown /${commandName} argument: ${arg}. Try /${commandName}, /${commandName} list, or /${commandName} clear.`,
          "warning",
        );
        return;
      }

      const files = await loadDiffs(pi, ctx.cwd, paths);
      if (!files) {
        ctx.ui.notify("Not inside a Git repository", "warning");
        return;
      }
      if (files.length === 0) {
        ctx.ui.notify("No reviewable file changes found", "info");
        return;
      }
      await showDiffViewer(pi, ctx, files, "last agent changes");
    },
  });

  pi.registerCommand("lg", {
    description: "Review all local Git changes",
    handler: async (_args, ctx) => {
      await ctx.waitForIdle();
      const paths = await getGitChangedFiles(pi, ctx.cwd);
      if (paths.size === 0) {
        ctx.ui.notify("Working tree is clean", "info");
        return;
      }
      const files = await loadDiffs(pi, ctx.cwd, paths);
      if (!files) {
        ctx.ui.notify("Not inside a Git repository", "warning");
        return;
      }
      if (files.length === 0) {
        ctx.ui.notify("No reviewable file changes found", "info");
        return;
      }
      await showDiffViewer(pi, ctx, files, "local changes");
    },
  });
}
