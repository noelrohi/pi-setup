import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const VERBS = [
	"ORA ORA",
	"MUDA MUDA",
	"YARE YARE DAZE",
	"ZA WARUDO",
	"ROAD ROLLER",
	"DORA DORA",
	"BAITESU DASUTO",
	"ARI ARI",
	"ARRIVEDERCI",
	"REQUIEM",
];

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

function randomVerb() {
	return VERBS[Math.floor(Math.random() * VERBS.length)];
}

function apply(ctx: ExtensionContext) {
	const theme = ctx.ui.theme;
	ctx.ui.setWorkingIndicator({
		frames: SPINNER.map((frame) => theme.fg("accent", frame)),
		intervalMs: 80,
	});
	ctx.ui.setWorkingMessage(theme.fg("muted", randomVerb()));
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => apply(ctx));
	pi.on("turn_start", async (_event, ctx) => apply(ctx));
}
