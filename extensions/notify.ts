import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";

const DEFAULT_SOUND = "/System/Library/Sounds/Funk.aiff";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function notify() {
  const sound = process.env.PI_NOTIFY_SOUND || DEFAULT_SOUND;

  // Run detached so pi does not wait on the notification command.
  const command = `afplay ${shellQuote(sound)}`;
  const child = spawn("/bin/sh", ["-lc", command], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export default function (pi: ExtensionAPI) {
  pi.on("agent_end", async () => {
    if (process.env.PI_NOTIFY_DISABLE === "1") return;
    notify();
  });

  pi.registerCommand("notify-test", {
    description: "Play the completion notification sound",
    handler: async (_args, ctx) => {
      notify();
      ctx.ui.notify("Notification test triggered", "info");
    },
  });
}
