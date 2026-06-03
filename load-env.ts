import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function parseEnvValue(raw: string) {
	const value = raw.trim();
	if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
		return value.slice(1, -1);
	}
	return value.replace(/\s+#.*$/, "");
}

function loadAgentEnv() {
	const envPath = join(homedir(), ".pi", "agent", ".env");
	let envText = "";

	try {
		envText = readFileSync(envPath, "utf8");
	} catch {
		return;
	}

	for (const line of envText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
		if (!match) continue;

		const [, name, rawValue] = match;
		if (!name || process.env[name]) continue;

		process.env[name] = parseEnvValue(rawValue ?? "");
	}
}

export default function (_pi: ExtensionAPI) {
	loadAgentEnv();
}
