import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_SECONDS = 30;
const MAX_TIMEOUT_SECONDS = 120;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 100_000;
const READABLE_CONTENT_TYPE_DESCRIPTION = "HTML, markdown, plain text, JSON, XML, or JavaScript";

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

function normalizeContentType(contentType: string) {
	return contentType.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isReadableContentType(contentType: string) {
	const mediaType = normalizeContentType(contentType);
	if (!mediaType) return true;
	if (mediaType.startsWith("image/") || mediaType.startsWith("audio/") || mediaType.startsWith("video/") || mediaType.startsWith("font/")) {
		return false;
	}
	if (mediaType.startsWith("text/")) return true;
	return (
		mediaType === "application/json" ||
		mediaType.endsWith("+json") ||
		mediaType === "application/xml" ||
		mediaType.endsWith("+xml") ||
		mediaType === "application/javascript" ||
		mediaType === "application/ecmascript"
	);
}

function startsWithBytes(bytes: Uint8Array, signature: number[]) {
	return signature.every((value, index) => bytes[index] === value);
}

function looksLikeBinary(arrayBuffer: ArrayBuffer) {
	const bytes = new Uint8Array(arrayBuffer);
	if (bytes.length === 0) return false;

	if (
		startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47]) || // PNG
		startsWithBytes(bytes, [0xff, 0xd8, 0xff]) || // JPEG
		startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38]) || // GIF
		startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) || // PDF
		startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) || // ZIP / OOXML / JAR
		startsWithBytes(bytes, [0x1f, 0x8b]) // gzip
	) {
		return true;
	}

	if (
		bytes.length >= 12 &&
		startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return true;
	}

	const sampleLength = Math.min(bytes.length, 4096);
	let controlCharacters = 0;
	for (let i = 0; i < sampleLength; i++) {
		const byte = bytes[i];
		if (byte === 0) return true;
		if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13 && byte !== 27) {
			controlCharacters++;
		}
	}

	return controlCharacters / sampleLength > 0.02;
}

function nonReadableMessage(url: string, reason: string) {
	return `Web fetch blocked: ${reason}. webfetch only reads ${READABLE_CONTENT_TYPE_DESCRIPTION}; use a page/document URL instead of an image, PDF, download, or binary asset. URL: ${url}`;
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
		description: "Fetch a URL directly without a search API. Converts HTML to markdown by default. Fails on images, PDFs, downloads, and other binary/non-readable assets.",
		promptSnippet: "Fetch exact URLs directly when the user provides a link or when a result URL needs to be read.",
		promptGuidelines: [
			"Use webfetch for exact URLs and docs pages.",
			"Use web_search for discovery/search queries; webfetch does not search by itself.",
			"Prefer markdown unless raw HTML or plain text is specifically needed.",
			"webfetch intentionally errors on image, PDF, download, and other binary/non-readable URLs; use a page or text endpoint instead.",
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

					const contentType = response.headers.get("content-type") ?? "";
					if (!isReadableContentType(contentType)) {
						throw new Error(nonReadableMessage(response.url, `non-readable content type ${normalizeContentType(contentType) || "unknown"}`));
					}

					const contentLength = response.headers.get("content-length");
					if (contentLength && Number(contentLength) > MAX_RESPONSE_SIZE) {
						throw new Error("Response too large (exceeds 5MB limit)");
					}

					const arrayBuffer = await response.arrayBuffer();
					if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
						throw new Error("Response too large (exceeds 5MB limit)");
					}

					if (looksLikeBinary(arrayBuffer)) {
						throw new Error(nonReadableMessage(response.url, "response body looks binary/non-text"));
					}

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
				throw new Error(`Web fetch failed: ${asErrorMessage(error)}`);
			}
		},
	});
}
