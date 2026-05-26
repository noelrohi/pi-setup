import { basename } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function shellQuote(value: string) {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

function getFishPath() {
	if (process.env.PI_USER_BASH_SHELL) return process.env.PI_USER_BASH_SHELL;
	if (process.env.SHELL && basename(process.env.SHELL) === "fish") {
		return process.env.SHELL;
	}
	return "/opt/homebrew/bin/fish";
}

export default function (pi: ExtensionAPI) {
	let localPromise: Promise<ReturnType<typeof import("@earendil-works/pi-coding-agent").createLocalBashOperations>> | undefined;
	const getLocal = async () => {
		localPromise ||= import("@earendil-works/pi-coding-agent").then((module) => module.createLocalBashOperations());
		return localPromise;
	};

	pi.on("user_bash", async () => {
		const local = await getLocal();
		return {
			operations: {
				exec(command, cwd, options) {
					// Run user-triggered ! / !! commands through fish so they match the user's shell.
					// Keep it non-interactive to avoid prompt integrations and job-control noise.
					const fishCommand = `exec ${shellQuote(getFishPath())} -c ${shellQuote(command)}`;
					return local.exec(fishCommand, cwd, options);
				},
			},
		};
	});
}
