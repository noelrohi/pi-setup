import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import Exa from "exa-js";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 100_000;

function readEnvValue(name: string) {
	if (process.env[name]) return process.env[name];

	const envPath = join(homedir(), ".pi", "agent", ".env");
	let envText = "";

	try {
		envText = readFileSync(envPath, "utf8");
	} catch {
		return undefined;
	}

	for (const line of envText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!match || match[1] !== name) continue;

		const value = match[2].trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			return value.slice(1, -1);
		}

		return value.replace(/\s+#.*$/, "");
	}

	return undefined;
}

function createClient() {
	const apiKey = readEnvValue("EXA_API_KEY");
	if (!apiKey) throw new Error("Missing EXA_API_KEY in environment or ~/.pi/agent/.env");
	return new Exa(apiKey);
}

function clampMaxChars(maxChars?: number) {
	return Math.min(maxChars ?? DEFAULT_MAX_OUTPUT_CHARS, MAX_OUTPUT_CHARS);
}

function truncateText(text: string, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[Output truncated to ${maxChars.toLocaleString()} characters from ${text.length.toLocaleString()}. Re-run with a larger maxChars if needed.]`;
}

function stringify(value: unknown, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
	return truncateText(JSON.stringify(value, null, 2), maxChars);
}

function resultMetadata(result: unknown, text: string) {
	return { originalChars: JSON.stringify(result).length, returnedChars: text.length };
}

function asErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Search Web",
		description: "Search the web with Exa. Can return highlights, summaries, or text content for results.",
		promptSnippet: "Search the web with Exa for current or external information.",
		promptGuidelines: [
			"Use web_search when the user asks for current web information, discovery, comparisons, or sources outside the workspace.",
			"Prefer highlights for quick discovery, summaries for overview, and text only when page content is needed.",
			"Use web_contents when the user gives exact URLs and asks to read them.",
		],
		parameters: Type.Object({
			query: Type.String({ description: "The search query." }),
			numResults: Type.Optional(Type.Number({ description: "Number of results. Defaults to 5.", minimum: 1, maximum: 20 })),
			type: Type.Optional(StringEnum(["auto", "keyword", "neural", "fast", "instant", "deep-lite", "deep", "deep-reasoning"] as const)),
			contents: Type.Optional(StringEnum(["none", "highlights", "summary", "text"] as const)),
			includeDomains: Type.Optional(Type.Array(Type.String(), { description: "Domains to include, e.g. ['reddit.com']" })),
			excludeDomains: Type.Optional(Type.Array(Type.String(), { description: "Domains to exclude." })),
			startPublishedDate: Type.Optional(Type.String({ description: "ISO date lower bound, e.g. 2024-01-01." })),
			endPublishedDate: Type.Optional(Type.String({ description: "ISO date upper bound." })),
			maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return. Defaults to 20000, max 100000." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			try {
				onUpdate?.({ content: [{ type: "text", text: `Searching Exa for: ${params.query}` }], details: {} });

				const contentMode = params.contents ?? "highlights";
				const contents = contentMode === "none" ? undefined : { [contentMode]: true };
				const client = createClient();
				const result = await client.search(params.query, {
					numResults: params.numResults ?? 5,
					type: params.type ?? "auto",
					contents,
					includeDomains: params.includeDomains,
					excludeDomains: params.excludeDomains,
					startPublishedDate: params.startPublishedDate,
					endPublishedDate: params.endPublishedDate,
				} as any);

				if (signal?.aborted) throw new Error("Search cancelled");

				const text = stringify(result, clampMaxChars(params.maxChars));
				return {
					content: [{ type: "text", text }],
					details: resultMetadata(result, text),
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: `Exa search failed: ${asErrorMessage(error)}` }],
					details: { error: asErrorMessage(error) },
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "web_contents",
		label: "Get Web Contents",
		description: "Fetch readable contents from specific URLs with Exa.",
		promptSnippet: "Fetch specific URLs with Exa when exact pages need to be read.",
		parameters: Type.Object({
			urls: Type.Array(Type.String(), { description: "URLs to fetch." }),
			contents: Type.Optional(StringEnum(["text", "summary", "highlights"] as const)),
			maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return. Defaults to 20000, max 100000." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			try {
				onUpdate?.({ content: [{ type: "text", text: `Fetching ${params.urls.length} URL(s) with Exa` }], details: {} });

				const contentMode = params.contents ?? "text";
				const client = createClient();
				const result = await client.getContents(params.urls, { [contentMode]: true } as any);

				if (signal?.aborted) throw new Error("Fetch cancelled");

				const text = stringify(result, clampMaxChars(params.maxChars));
				return {
					content: [{ type: "text", text }],
					details: resultMetadata(result, text),
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: `Exa contents failed: ${asErrorMessage(error)}` }],
					details: { error: asErrorMessage(error) },
					isError: true,
				};
			}
		},
	});

	pi.registerTool({
		name: "web_answer",
		label: "Answer Web Question",
		description: "Ask Exa for a direct answer with citations.",
		promptSnippet: "Use Exa answer for direct factual questions that need web citations.",
		parameters: Type.Object({
			question: Type.String({ description: "Question to answer with web citations." }),
			maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return. Defaults to 20000, max 100000." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			try {
				onUpdate?.({ content: [{ type: "text", text: `Asking Exa: ${params.question}` }], details: {} });

				const client = createClient();
				const result = await client.answer(params.question);

				if (signal?.aborted) throw new Error("Answer cancelled");

				const text = stringify(result, clampMaxChars(params.maxChars));
				return {
					content: [{ type: "text", text }],
					details: resultMetadata(result, text),
				};
			} catch (error) {
				return {
					content: [{ type: "text", text: `Exa answer failed: ${asErrorMessage(error)}` }],
					details: { error: asErrorMessage(error) },
					isError: true,
				};
			}
		},
	});
}
