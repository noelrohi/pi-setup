import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

let modelLabel = "?";
let providerLabel = "?";
let thinkingLabel = "?";
let gitStatus = "-";
let interval: ReturnType<typeof setInterval> | undefined;
let requestRender: (() => void) | undefined;

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

async function updateGit(pi: ExtensionAPI) {
	const result = await pi.exec("sh", [
		"-lc",
		"git rev-parse --is-inside-work-tree >/dev/null 2>&1 && { branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || git rev-parse --short HEAD); dirty=$(git status --porcelain 2>/dev/null | head -1); printf '%s%s' \"$branch\" \"${dirty:+*}\"; }",
	], { timeout: 1000 });
	gitStatus = result.code === 0 && result.stdout.trim() ? result.stdout.trim() : "-";
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
				const git = theme.fg("dim", "git") + ":" + theme.fg(gitStatus.endsWith("*") ? "error" : "accent", gitStatus);

				// Keep the reasoning level visible at all widths. The previous final-line
				// truncate could cut the right side down to only "reasoning...".
				const reasoningFull = theme.fg("dim", "reasoning") + ":" + theme.fg("accent", thinkingLabel);
				const reasoningCompact = theme.fg("dim", "r") + ":" + theme.fg("accent", thinkingLabel);
				const right = visibleWidth(reasoningFull) + 2 <= width ? reasoningFull : reasoningCompact;

				// Priority when narrow: always keep reasoning, then model, then dir.
				// Drop git first, then time.
				const leftParts = [model, time, dir, git];
				while (leftParts.length > 1) {
					const leftCandidate = leftParts.join(sep);
					if (visibleWidth(leftCandidate) + 1 + visibleWidth(right) <= width) break;
					const gitIndex = leftParts.indexOf(git);
					if (gitIndex !== -1) {
						leftParts.splice(gitIndex, 1);
						continue;
					}
					const timeIndex = leftParts.indexOf(time);
					if (timeIndex !== -1) {
						leftParts.splice(timeIndex, 1);
						continue;
					}
					break;
				}

				const rightWidth = visibleWidth(right);
				if (rightWidth >= width) return [truncateToWidth(right, width)];

				const leftBudget = Math.max(0, width - rightWidth - 1);
				const left = truncateToWidth(leftParts.join(sep), leftBudget);
				const pad = " ".repeat(Math.max(1, width - visibleWidth(left) - rightWidth));
				return [left + pad + right];
			},
		};
	});
}

export default function (pi: ExtensionAPI) {
	async function refresh(ctx?: ExtensionContext) {
		await updateGit(pi).catch(() => undefined);
		requestRender?.();
		if (ctx && !requestRender) installFooter(ctx);
	}

	pi.on("session_start", async (_event, ctx) => {
		modelLabel = displayModel(ctx.model?.id || modelLabel);
		providerLabel = ctx.model?.provider || providerLabel;
		thinkingLabel = pi.getThinkingLevel();
		installFooter(ctx);
		await refresh(ctx);
		if (interval) clearInterval(interval);
		interval = setInterval(() => refresh(), 30_000);
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

	pi.on("session_shutdown", async () => {
		if (interval) clearInterval(interval);
	});
}
