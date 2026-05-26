import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

let modelLabel = "?";
let providerLabel = "?";
let thinkingLabel = "?";
let contextLabel = "ctx:?";
let gitStatus = "-";
let interval: ReturnType<typeof setInterval> | undefined;
let requestRender: (() => void) | undefined;
let lastGitRefresh = 0;
let gitRefreshPromise: Promise<void> | undefined;

const GIT_REFRESH_THROTTLE_MS = 5_000;
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;

function visibleWidth(value: string) {
	return value.replace(ANSI_PATTERN, "").length;
}

function truncateToWidth(value: string, width: number) {
	if (visibleWidth(value) <= width) return value;
	// Keep the footer cheap: in the rare case we need truncation, avoid expensive ANSI-aware slicing.
	return value.replace(ANSI_PATTERN, "").slice(0, Math.max(0, width - 1)) + "…";
}

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
	if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}m`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 10_000 ? 0 : 1)}k`;
	return String(tokens);
}

function updateContext(ctx?: ExtensionContext) {
	if (!ctx) return;
	const usage = ctx.getContextUsage();
	const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow;
	if (!usage || usage.tokens === null || usage.percent === null || !contextWindow) {
		contextLabel = "ctx:?";
		return;
	}
	const used = Math.max(0, usage.tokens);
	const remaining = Math.max(0, contextWindow - used);
	contextLabel = `ctx:${Math.round(usage.percent)}% ${formatTokens(used)}→${formatTokens(contextWindow)} +${formatTokens(remaining)}`;
}

async function updateGit(pi: ExtensionAPI) {
	const result = await pi.exec("sh", [
		"-lc",
		"git rev-parse --is-inside-work-tree >/dev/null 2>&1 && { branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD); dirty=$(git status --porcelain 2>/dev/null | head -1); printf '%s%s' \"$branch\" \"${dirty:+*}\"; }",
	], { timeout: 1000 });
	gitStatus = result.code === 0 && result.stdout.trim() ? result.stdout.trim() : "-";
	lastGitRefresh = Date.now();
}

function refreshGit(pi: ExtensionAPI, force = false) {
	const now = Date.now();
	if (gitRefreshPromise) return force ? gitRefreshPromise : undefined;
	if (!force && now - lastGitRefresh < GIT_REFRESH_THROTTLE_MS) return undefined;

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
				const cwd = process.cwd().split("/").filter(Boolean).pop() || process.cwd();
				const sep = theme.fg("borderMuted", " │ ");
				const model = theme.fg("dim", "model") + ": " + theme.fg("accent", modelLabel) + theme.fg("dim", ` (${providerLabel})`);
				const dir = theme.fg("dim", "dir") + ":" + theme.fg("success", cwd);
				const time = theme.fg("dim", "時") + ":" + theme.fg("warning", timeLabel());
				const context = theme.fg("warning", contextLabel);
				const git = theme.fg("dim", "git") + ":" + theme.fg(gitStatus.endsWith("*") ? "error" : "accent", gitStatus);

				const reasoning = theme.fg("dim", "reasoning") + ":" + theme.fg("accent", thinkingLabel);
				const parts = [model, context, time, dir, git, reasoning];

				// On narrow terminals, wrap instead of dropping fields so every status item
				// remains visible. If one field is wider than the terminal, truncate only
				// that field; otherwise preserve full labels and separators.
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
				return lines.map((line) => truncateToWidth(line, width));
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	async function refresh(ctx?: ExtensionContext, options: { forceGit?: boolean } = {}) {
		updateContext(ctx);
		await refreshGit(pi, options.forceGit);
		requestRender?.();
		if (ctx && !requestRender) installFooter(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		modelLabel = displayModel(ctx.model?.id || modelLabel);
		providerLabel = ctx.model?.provider || providerLabel;
		thinkingLabel = pi.getThinkingLevel();
		installFooter(ctx);
		await refresh(ctx, { forceGit: true });
		if (interval) clearInterval(interval);
		interval = setInterval(() => void refresh(undefined, { forceGit: true }), 30_000);
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

	pi.on("turn_start", async (_event, ctx) => refresh(ctx));
	pi.on("turn_end", async (_event, ctx) => refresh(ctx));
	pi.on("message_end", async (_event, ctx) => refresh(ctx));

	pi.on("session_shutdown", async () => {
		if (interval) clearInterval(interval);
		interval = undefined;
	});
}
