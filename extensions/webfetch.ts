import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 100_000;

function StringEnum<T extends readonly string[]>(values: T, options?: { description?: string; default?: T[number] }) {
	return Type.Unsafe<T[number]>({
		type: "string",
		enum: values as unknown as string[],
		...(options?.description ? { description: options.description } : {}),
		...(options?.default ? { default: options.default } : {}),
	});
}

function asErrorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error);
}

function withTimeout(ms: number, signal?: AbortSignal) {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(new Error("Request timed out")), ms);

	if (signal) {
		if (signal.aborted) controller.abort(signal.reason);
		signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
	}

	return { signal: controller.signal, clear: () => clearTimeout(timeout) };
}

async function htmlToMarkdown(html: string) {
	const { default: TurndownService } = await import("turndown");
	const turndown = new TurndownService({
		headingStyle: "atx",
		hr: "---",
		bulletListMarker: "-",
		codeBlockStyle: "fenced",
		emDelimiter: "*",
	});
	turndown.remove(["script", "style", "meta", "link", "noscript", "iframe", "object", "embed"]);
	return turndown.turndown(html).trim();
}

function truncateText(text: string, maxChars = DEFAULT_MAX_OUTPUT_CHARS) {
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars)}\n\n[Output truncated to ${maxChars.toLocaleString()} characters from ${text.length.toLocaleString()}. Re-fetch with a larger maxChars if needed.]`;
}

function htmlToText(html: string) {
	return html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&#39;/g, "'")
		.replace(/\s+/g, " ")
		.trim();
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "webfetch",
		label: "Fetch Web Page",
		description: "Fetch a URL directly without a search API. Converts HTML to markdown by default.",
		promptSnippet: "Fetch exact URLs directly when the user provides a link or when a result URL needs to be read.",
		promptGuidelines: [
			"Use webfetch for exact URLs and docs pages.",
			"Use web_search for discovery/search queries; webfetch does not search by itself.",
			"Prefer markdown unless raw HTML or plain text is specifically needed.",
		],
		parameters: Type.Object({
			url: Type.String({ description: "Fully-qualified URL to fetch. Must start with http:// or https://." }),
			format: Type.Optional(StringEnum(["markdown", "text", "html"] as const)),
			timeout: Type.Optional(Type.Number({ description: "Timeout in seconds. Max 120. Defaults to 30." })),
			maxChars: Type.Optional(Type.Number({ description: "Maximum characters to return. Defaults to 20000, max 100000." })),
		}),
		async execute(_toolCallId, params, signal, onUpdate) {
			try {
				if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
					throw new Error("URL must start with http:// or https://");
				}

				onUpdate?.({ content: [{ type: "text", text: `Fetching URL: ${params.url}` }], details: {} });

				const timeoutSeconds = Math.min(params.timeout ?? DEFAULT_TIMEOUT_SECONDS, MAX_TIMEOUT_SECONDS);
				const timeout = withTimeout(timeoutSeconds * 1000, signal);
				const format = params.format ?? "markdown";
				const accept =
					format === "markdown"
						? "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
						: format === "text"
							? "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
							: "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1";

				try {
					const response = await fetch(params.url, {
						signal: timeout.signal,
						headers: {
							"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
							Accept: accept,
							"Accept-Language": "en-US,en;q=0.9",
						},
					});

					if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);

					const contentLength = response.headers.get("content-length");
					if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
						throw new Error("Response too large (exceeds 5MB limit)");
					}

					const arrayBuffer = await response.arrayBuffer();
					if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
						throw new Error("Response too large (exceeds 5MB limit)");
					}

					const contentType = response.headers.get("content-type") ?? "";
					const raw = new TextDecoder().decode(arrayBuffer);
					const isHtml = contentType.includes("text/html") || /<html[\s>]/i.test(raw);
					const output = format === "html" ? raw : isHtml ? (format === "text" ? htmlToText(raw) : await htmlToMarkdown(raw)) : raw;
					const maxChars = Math.min(params.maxChars ?? DEFAULT_MAX_OUTPUT_CHARS, MAX_OUTPUT_CHARS);
					const text = output ? truncateText(output, maxChars) : "No readable content returned.";

					return {
						content: [{ type: "text", text }],
						details: { url: response.url, status: response.status, contentType, format, originalChars: output.length, returnedChars: text.length },
					};
				} finally {
					timeout.clear();
				}
			} catch (error) {
				return {
					content: [{ type: "text", text: `Web fetch failed: ${asErrorMessage(error)}` }],
					details: { error: asErrorMessage(error) },
					isError: true,
				};
			}
		},
	});
}
