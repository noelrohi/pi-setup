import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  getCapabilities,
  hyperlink,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

let modelLabel = "?";
let providerLabel = "?";
let thinkingLabel = "?";
let contextLabel = "ctx:?";
let gitStatus = "-";
let pullRequest: { number: number; url: string } | undefined;
let cost = 0;
let tokensPerSecond: number | undefined;
let interval: ReturnType<typeof setInterval> | undefined;
let requestRender: (() => void) | undefined;
let sessionCwd = process.cwd();
let lastGitRefresh = 0;
let lastPullRequestRefresh = 0;
let pullRequestBranch: string | undefined;
let gitRefreshPromise: Promise<void> | undefined;
let streamStartedAt: number | undefined;
let lastStreamDeltaAt: number | undefined;
let streamedCharacters = 0;
let firstChunkCharacters = 0;
let streamEventCount = 0;
let streamIncludedToolCall = false;
let lastRateRender = 0;

const GIT_REFRESH_THROTTLE_MS = 5_000;
const PR_REFRESH_THROTTLE_MS = 60_000;
const RATE_RENDER_THROTTLE_MS = 200;
const ESTIMATED_CHARS_PER_TOKEN = 4;

function displayModel(id: string) {
  return id.replace(/^claude-/, "").replace(/-20\d{6}$/, "");
}

function timeLabel() {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date());
}

function formatTokens(tokens: number) {
  if (tokens >= 1_000_000)
    return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}m`;
  if (tokens >= 1_000)
    return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
  return String(tokens);
}

function updateContext(ctx?: ExtensionContext) {
  if (!ctx) return;
  const usage = ctx.getContextUsage();
  const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
  if (
    !usage ||
    usage.tokens === null ||
    usage.percent === null ||
    !contextWindow
  ) {
    contextLabel = "ctx:?";
    return;
  }
  const used = Math.max(0, usage.tokens);
  const remaining = Math.max(0, contextWindow - used);
  contextLabel = `ctx:${Math.round(usage.percent)}% ${formatTokens(used)}→${formatTokens(contextWindow)} +${formatTokens(remaining)}`;
}

function updateCost(ctx?: ExtensionContext) {
  if (!ctx) return;
  cost = ctx.sessionManager.getBranch().reduce((total, entry) => {
    if (entry.type !== "message" || entry.message.role !== "assistant")
      return total;
    return total + (entry.message.usage.cost.total || 0);
  }, 0);
}

function resetStreamTracking() {
  streamStartedAt = undefined;
  lastStreamDeltaAt = undefined;
  streamedCharacters = 0;
  firstChunkCharacters = 0;
  streamEventCount = 0;
  streamIncludedToolCall = false;
  lastRateRender = 0;
}

async function refreshPullRequest(pi: ExtensionAPI, branch: string) {
  const now = Date.now();
  if (
    branch === pullRequestBranch &&
    now - lastPullRequestRefresh < PR_REFRESH_THROTTLE_MS
  )
    return;

  pullRequestBranch = branch;
  lastPullRequestRefresh = now;
  pullRequest = undefined;
  const result = await pi.exec(
    "gh",
    ["pr", "view", branch, "--json", "number,url,state"],
    { cwd: sessionCwd, timeout: 5_000 },
  );
  if (result.code !== 0) return;

  try {
    const value = JSON.parse(result.stdout) as {
      number?: unknown;
      url?: unknown;
      state?: unknown;
    };
    if (
      typeof value.number === "number" &&
      typeof value.url === "string" &&
      value.state === "OPEN"
    ) {
      pullRequest = { number: value.number, url: value.url };
    }
  } catch {
    // Treat malformed or unavailable gh output as no pull request.
  }
}

async function updateGit(pi: ExtensionAPI) {
  const result = await pi.exec(
    "sh",
    [
      "-lc",
      'git rev-parse --is-inside-work-tree >/dev/null 2>&1 && { branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD); dirty=$(git status --porcelain 2>/dev/null | head -1); printf \'%s%s\' "$branch" "${dirty:+*}"; }',
    ],
    { cwd: sessionCwd, timeout: 1_000 },
  );
  gitStatus =
    result.code === 0 && result.stdout.trim() ? result.stdout.trim() : "-";
  lastGitRefresh = Date.now();

  const branch = gitStatus === "-" ? undefined : gitStatus.replace(/\*$/, "");
  if (branch) await refreshPullRequest(pi, branch);
  else {
    pullRequest = undefined;
    pullRequestBranch = undefined;
  }
}

function refreshGit(pi: ExtensionAPI, force = false) {
  const now = Date.now();
  if (gitRefreshPromise) return force ? gitRefreshPromise : undefined;
  if (!force && now - lastGitRefresh < GIT_REFRESH_THROTTLE_MS)
    return undefined;

  gitRefreshPromise = updateGit(pi)
    .catch(() => undefined)
    .finally(() => {
      gitRefreshPromise = undefined;
      requestRender?.();
    });

  return force ? gitRefreshPromise : undefined;
}

function installFooter(ctx: ExtensionContext) {
  ctx.ui.setFooter((tui, theme, footerData) => {
    requestRender = () => tui.requestRender();
    const unsub = footerData.onBranchChange(() => tui.requestRender());

    return {
      dispose() {
        unsub();
        requestRender = undefined;
      },
      invalidate() {},
      render(width: number): string[] {
        const cwd = sessionCwd.split("/").filter(Boolean).pop() || sessionCwd;
        const sep = theme.fg("borderMuted", " │ ");
        const model =
          theme.fg("dim", "model") +
          ": " +
          theme.fg("accent", modelLabel) +
          theme.fg("dim", ` (${providerLabel})`);
        const dir = theme.fg("dim", "dir") + ":" + theme.fg("success", cwd);
        const time =
          theme.fg("dim", "時") + ":" + theme.fg("warning", timeLabel());
        const context = theme.fg("warning", contextLabel);
        let gitLabel = gitStatus;
        if (pullRequest) {
          const label = `PR#${pullRequest.number}`;
          const linked = getCapabilities().hyperlinks
            ? hyperlink(label, pullRequest.url)
            : label;
          gitLabel += ` ${linked}`;
        }
        const git =
          theme.fg("dim", "git") +
          ":" +
          theme.fg(gitStatus.endsWith("*") ? "error" : "accent", gitLabel);
        const reasoning =
          theme.fg("dim", "reasoning") +
          ":" +
          theme.fg("accent", thinkingLabel);
        const costLabel =
          theme.fg("dim", "cost") +
          ":" +
          theme.fg("success", `$${cost.toFixed(2)}`);
        const rate =
          theme.fg("dim", "speed") +
          ":" +
          theme.fg(
            "accent",
            tokensPerSecond === undefined
              ? "—"
              : `${Math.round(tokensPerSecond)} tok/s`,
          );
        const parts = [
          model,
          context,
          costLabel,
          rate,
          time,
          dir,
          git,
          reasoning,
        ];

        const lines: string[] = [];
        let line = "";
        for (const part of parts) {
          const next = line ? line + sep + part : part;
          if (line && visibleWidth(next) > width) {
            lines.push(line);
            line = part;
          } else {
            line = next;
          }
        }
        if (line) lines.push(line);
        return lines.map((value) => truncateToWidth(value, width));
      },
    };
  });
}

export default function (pi: ExtensionAPI) {
  async function refresh(
    ctx?: ExtensionContext,
    options: { forceGit?: boolean } = {},
  ) {
    updateContext(ctx);
    updateCost(ctx);
    await refreshGit(pi, options.forceGit);
    requestRender?.();
    if (ctx && !requestRender) installFooter(ctx);
  }

  pi.on("session_start", async (_event, ctx) => {
    sessionCwd = ctx.cwd;
    modelLabel = displayModel(ctx.model?.id || modelLabel);
    providerLabel = ctx.model?.provider || providerLabel;
    thinkingLabel = pi.getThinkingLevel();
    pullRequest = undefined;
    pullRequestBranch = undefined;
    lastPullRequestRefresh = 0;
    tokensPerSecond = undefined;
    resetStreamTracking();
    installFooter(ctx);
    await refresh(ctx, { forceGit: true });
    if (interval) clearInterval(interval);
    interval = setInterval(
      () => void refresh(undefined, { forceGit: true }),
      30_000,
    );
  });

  pi.on("model_select", async (event, ctx) => {
    modelLabel = displayModel(event.model.id);
    providerLabel = event.model.provider;
    await refresh(ctx);
  });

  pi.on("thinking_level_select", async (event, ctx) => {
    thinkingLabel = event.level;
    await refresh(ctx);
  });

  pi.on("message_start", (event) => {
    if (event.message.role === "assistant") resetStreamTracking();
  });

  pi.on("message_update", (event) => {
    if (event.message.role !== "assistant") return;
    const streamEvent = event.assistantMessageEvent;
    if (streamEvent.type === "toolcall_delta") {
      streamIncludedToolCall = true;
      return;
    }
    if (
      streamEvent.type !== "text_delta" &&
      streamEvent.type !== "thinking_delta"
    )
      return;
    if (!streamEvent.delta) return;

    const now = Date.now();
    if (streamStartedAt === undefined) {
      streamStartedAt = now;
      firstChunkCharacters = streamEvent.delta.length;
    }
    lastStreamDeltaAt = now;
    streamedCharacters += streamEvent.delta.length;
    streamEventCount += 1;
    const elapsed = now - streamStartedAt;
    const generatedCharacters = streamedCharacters - firstChunkCharacters;
    if (streamEventCount < 2 || elapsed <= 0 || generatedCharacters <= 0)
      return;

    tokensPerSecond =
      generatedCharacters / ESTIMATED_CHARS_PER_TOKEN / (elapsed / 1_000);
    if (now - lastRateRender >= RATE_RENDER_THROTTLE_MS) {
      lastRateRender = now;
      requestRender?.();
    }
  });

  pi.on("message_end", (event, ctx) => {
    if (event.message.role !== "assistant") return;
    streamIncludedToolCall ||= event.message.content.some(
      (part) => part.type === "toolCall",
    );
    if (
      streamStartedAt !== undefined &&
      lastStreamDeltaAt !== undefined &&
      streamEventCount >= 2
    ) {
      const elapsed = lastStreamDeltaAt - streamStartedAt;
      if (elapsed >= 50) {
        const estimatedFirstChunk = Math.ceil(
          firstChunkCharacters / ESTIMATED_CHARS_PER_TOKEN,
        );
        const generatedTokens =
          !streamIncludedToolCall && event.message.usage.output > 0
            ? Math.max(0, event.message.usage.output - estimatedFirstChunk)
            : Math.max(
                0,
                Math.ceil(streamedCharacters / ESTIMATED_CHARS_PER_TOKEN) -
                  estimatedFirstChunk,
              );
        if (generatedTokens > 0)
          tokensPerSecond = generatedTokens / (elapsed / 1_000);
      }
    }
    resetStreamTracking();
    void refresh(ctx);
  });

  pi.on("turn_start", async (_event, ctx) => refresh(ctx));
  pi.on("turn_end", async (_event, ctx) => refresh(ctx));

  pi.on("session_shutdown", async () => {
    if (interval) clearInterval(interval);
    interval = undefined;
    requestRender = undefined;
    resetStreamTracking();
  });
}
