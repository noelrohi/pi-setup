import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import http from "node:http";

const DEFAULT_SOCKET_PATH = "/Users/rohi/Library/Application Support/Roam/roam-local-api-beta.sock";
const SOCKET_PATH = process.env.PI_ROAM_SOCKET_PATH || DEFAULT_SOCKET_PATH;
// Roam's local activity API exposes agent namespaces for this activity stream.
// Send to Codex and Claude Code by default so Roam can light up either integration.
// Roam's Claude namespace is "claude-code".
// Override with PI_ROAM_AGENT_NAMES="codex,claude-code" (or legacy PI_ROAM_AGENT_NAME).
const AGENT_NAMES = (process.env.PI_ROAM_AGENT_NAMES || process.env.PI_ROAM_AGENT_NAME || "codex,claude-code")
  .split(",")
  .map((name) => name.trim())
  .filter(Boolean);
const REQUEST_TIMEOUT_MS = Number(process.env.PI_ROAM_TIMEOUT_MS || 200);

type RoamActivityEvent = "user-prompt-submit" | "post-tool-use" | "stop";

function isEventSupported(agentName: string, event: RoamActivityEvent): boolean {
  // Roam currently supports Claude Code activity for tool-use and stop only.
  return agentName !== "claude-code" || event !== "user-prompt-submit";
}

function isDisabled(): boolean {
  return process.env.PI_ROAM_DISABLE === "1" || process.env.PI_ROAM_DISABLE === "true";
}

function getActivityQuery(agentName: string, sessionId: string): string {
  // Claude Code's own Roam hook uses ?pid=$PPID, while Codex uses ?sessionId=...
  // Match that shape so Roam can clear the exact activity bucket it creates.
  if (agentName === "claude-code") return `pid=${encodeURIComponent(String(process.pid))}`;
  return `sessionId=${encodeURIComponent(sessionId)}`;
}

function sendActivity(agentName: string, event: RoamActivityEvent, sessionId: string): void {
  try {
    const path = `/api/v1/activity/${encodeURIComponent(agentName)}/${event}?${getActivityQuery(agentName, sessionId)}`;
    const req = http.request(
      {
        socketPath: SOCKET_PATH,
        method: "POST",
        path,
        timeout: REQUEST_TIMEOUT_MS,
        headers: { Connection: "close" },
      },
      (res) => {
        res.resume();
      },
    );

    req.on("socket", (socket) => {
      socket.unref();
    });
    req.on("timeout", () => {
      req.destroy();
    });
    req.on("error", () => {
      // Roam may be closed or the local API socket may not exist. Never block pi.
    });
    req.end();
  } catch {
    // Keep activity capture best-effort and silent.
  }
}

function getAgentNamesForModel(modelId: string | undefined): string[] {
  const normalizedModelId = modelId?.toLowerCase() || "";
  const targetAgentName = normalizedModelId.startsWith("claude")
    ? "claude-code"
    : normalizedModelId.startsWith("gpt")
      ? "codex"
      : undefined;

  if (!targetAgentName) return [];
  return AGENT_NAMES.filter((agentName) => agentName === targetAgentName);
}

function postActivity(event: RoamActivityEvent, sessionId: string | undefined, modelId: string | undefined): void {
  if (isDisabled() || !sessionId) return;

  for (const agentName of getAgentNamesForModel(modelId)) {
    if (!isEventSupported(agentName, event)) continue;
    sendActivity(agentName, event, sessionId);

    // Roam can receive pi's tool-end and agent-end hooks almost back-to-back.
    // For Claude Code, give the final pid-based stop a short retry so it wins races
    // with any in-flight post-tool-use request and reliably clears activity state.
    if (agentName === "claude-code" && event === "stop") {
      setTimeout(() => sendActivity(agentName, event, sessionId), 300).unref();
      setTimeout(() => sendActivity(agentName, event, sessionId), 1000).unref();
    }
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("input", async (_event, ctx) => {
    postActivity("user-prompt-submit", ctx.sessionManager.getSessionId(), ctx.model?.id);
    return { action: "continue" };
  });

  pi.on("tool_execution_end", async (_event, ctx) => {
    postActivity("post-tool-use", ctx.sessionManager.getSessionId(), ctx.model?.id);
  });

  pi.on("agent_end", async (_event, ctx) => {
    postActivity("stop", ctx.sessionManager.getSessionId(), ctx.model?.id);
  });

  pi.registerCommand("roam-activity-test", {
    description: "Send a test pi activity event to Roam",
    handler: async (_args, ctx) => {
      postActivity("stop", ctx.sessionManager.getSessionId(), ctx.model?.id);
      ctx.ui.notify("Sent Roam activity test event", "info");
    },
  });
}
