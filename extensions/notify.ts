import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import path from "node:path";

const DEFAULT_SOUND = "/System/Library/Sounds/Funk.aiff";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function notify(directory: string) {
  const folderName = path.basename(directory) || "unknown";
  const sound = process.env.PI_NOTIFY_SOUND || DEFAULT_SOUND;
  const voiceText = process.env.PI_NOTIFY_TEXT || folderName;

  // Match the opencode plugin: play a sound, then speak the project folder.
  // Run detached so pi does not wait on the notification command.
  const command = `afplay ${shellQuote(sound)} && say ${shellQuote(voiceText)}`;
  const child = spawn("/bin/sh", ["-lc", command], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async (_event, ctx) => {
    if (process.env.PI_NOTIFY_DISABLE === "1") return;
    notify(ctx.cwd);
  });

  pi.registerCommand("notify-test", {
    description: "Play the completion notification sound/speech",
    handler: async (_args, ctx) => {
      notify(ctx.cwd);
      ctx.ui.notify("Notification test triggered", "info");
    },
  });
}
