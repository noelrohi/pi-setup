import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
import { readdir } from "node:fs/promises";
import path from "node:path";

const MAX_FILES = 20_000;
const MAX_SUGGESTIONS = 20;
const CACHE_TTL_MS = 30_000;

const IGNORE_DIRS = new Set([
	".git",
	"node_modules",
	"dist",
	"build",
	".next",
	".nuxt",
	"coverage",
	".cache",
	".turbo",
	".venv",
	"venv",
]);

let cache: { cwd: string; loadedAt: number; paths: string[] } | undefined;

function extractAtToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(/(?:^|[ \t])@([^\s@]*)$/);
	return match?.[1];
}

function normalize(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function subsequenceScore(query: string, target: string): number | undefined {
	if (!query) return 0;

	let qi = 0;
	let first = -1;
	let last = -1;
	let gaps = 0;
	let previous = -1;

	for (let ti = 0; ti < target.length && qi < query.length; ti++) {
		if (target[ti] !== query[qi]) continue;
		if (first === -1) first = ti;
		if (previous !== -1) gaps += Math.max(0, ti - previous - 1);
		previous = ti;
		last = ti;
		qi++;
	}

	if (qi !== query.length) return undefined;
	const span = last - first + 1;
	return span + gaps * 0.15 + first * 0.05;
}

async function walk(dir: string, root: string, out: string[]): Promise<void> {
	if (out.length >= MAX_FILES) return;

	let entries;
	try {
		entries = await readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const entry of entries) {
		if (out.length >= MAX_FILES) return;
		if (entry.name.startsWith(".") && entry.name !== ".github") continue;
		const absolute = path.join(dir, entry.name);
		const relative = path.relative(root, absolute).split(path.sep).join("/");
		if (entry.isDirectory()) {
			if (IGNORE_DIRS.has(entry.name)) continue;
			out.push(`${relative}/`);
			await walk(absolute, root, out);
		} else if (entry.isFile()) {
			out.push(relative);
		}
	}
}

async function getPaths(cwd: string): Promise<string[]> {
	const now = Date.now();
	if (cache && cache.cwd === cwd && now - cache.loadedAt < CACHE_TTL_MS) {
		return cache.paths;
	}

	const paths: string[] = [];
	await walk(cwd, cwd, paths);
	cache = { cwd, loadedAt: now, paths };
	return paths;
}

function isDirectChildOf(candidate: string, directoryPrefix: string): boolean {
	if (!candidate.startsWith(directoryPrefix) || candidate === directoryPrefix) return false;
	const rest = candidate.slice(directoryPrefix.length);
	return rest.endsWith("/") ? !rest.slice(0, -1).includes("/") : !rest.includes("/");
}

function toAutocompleteItem(candidate: string): AutocompleteItem {
	const isDirectory = candidate.endsWith("/");
	const displayPath = isDirectory ? candidate.slice(0, -1) : candidate;
	const basename = displayPath.split("/").at(-1) ?? displayPath;
	return {
		value: `@${candidate}`,
		label: isDirectory ? `${basename}/` : basename,
		description: isDirectory ? `${candidate} · folder` : candidate,
	};
}

function rankPaths(paths: string[], rawQuery: string): AutocompleteItem[] {
	const lowerRawQuery = rawQuery.toLowerCase();
	const query = normalize(rawQuery);
	if (!query) return [];

	const prefixMatches = lowerRawQuery.includes("/")
		? paths
				.filter((candidate) =>
					lowerRawQuery.endsWith("/")
						? isDirectChildOf(candidate.toLowerCase(), lowerRawQuery)
						: candidate.toLowerCase().startsWith(lowerRawQuery),
				)
				.map((candidate) => ({ candidate, score: lowerRawQuery.endsWith("/") ? 0 : 1 }))
		: [];

	const fuzzyMatches = paths
		.map((candidate) => {
			const displayPath = candidate.endsWith("/") ? candidate.slice(0, -1) : candidate;
			const compactPath = normalize(candidate);
			const compactTail = normalize(displayPath.split("/").slice(-2).join("/"));
			const compactBase = normalize(path.basename(displayPath));
			const scores = [
				subsequenceScore(query, compactPath),
				subsequenceScore(query, compactTail),
				subsequenceScore(query, compactBase),
			].filter((score): score is number => score !== undefined);
			if (scores.length === 0) return undefined;
			return { candidate, score: Math.min(...scores) + 10 };
		})
		.filter((match): match is { candidate: string; score: number } => Boolean(match));

	const seen = new Set<string>();
	return [...prefixMatches, ...fuzzyMatches]
		.filter(({ candidate }) => {
			if (seen.has(candidate)) return false;
			seen.add(candidate);
			return true;
		})
		.sort((a, b) => a.score - b.score || a.candidate.length - b.candidate.length || a.candidate.localeCompare(b.candidate))
		.slice(0, MAX_SUGGESTIONS)
		.map(({ candidate }) => toAutocompleteItem(candidate));
}

function mergeSuggestions(smartItems: AutocompleteItem[], builtIn: AutocompleteSuggestions | null, prefix: string): AutocompleteSuggestions {
	const seen = new Set<string>();
	const items: AutocompleteItem[] = [];
	for (const item of [...smartItems, ...(builtIn?.items ?? [])]) {
		if (seen.has(item.value)) continue;
		seen.add(item.value);
		items.push(item);
		if (items.length >= MAX_SUGGESTIONS) break;
	}
	return { prefix, items };
}

function createProvider(current: AutocompleteProvider, cwd: string): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const line = lines[cursorLine] ?? "";
			const token = extractAtToken(line.slice(0, cursorCol));
			if (token === undefined) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const builtIn = await current.getSuggestions(lines, cursorLine, cursorCol, options);
			if (!token.trim() || options.signal.aborted) return builtIn;

			const paths = await getPaths(cwd);
			if (options.signal.aborted) return builtIn;

			const smartItems = rankPaths(paths, token);
			if (smartItems.length === 0) return builtIn;

			return mergeSuggestions(smartItems, builtIn, `@${token}`);
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

export default function (pi: ExtensionAPI): void {
	pi.on("session_start", (_event, ctx) => {
		ctx.ui.addAutocompleteProvider((current) => createProvider(current, ctx.cwd));
	});
}
