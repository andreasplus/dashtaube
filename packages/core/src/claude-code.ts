import type { TaubeEventInput } from "./event.js";
import { LIMITS } from "./event.js";

/**
 * Felder, die Claude Code an Hooks auf stdin übergibt. Wir lesen nur, was wir brauchen,
 * und kommen auch mit fehlenden Feldern zurecht, weil sich das Format ändern kann.
 */
export interface ClaudeCodeHookInput {
  hook_event_name?: string;
  session_id?: string;
  cwd?: string;
  message?: string;
  title?: string;
  notification_type?: string;
  last_assistant_message?: string;
  agent_type?: string;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** Ordnername aus einem Pfad (Unix oder Windows). */
export function projectFromCwd(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined;
  const parts = cwd.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1);
}

/**
 * Wandelt die Eingabe eines Claude-Code-Hooks (Notification, Stop, SubagentStop, …)
 * in ein Taube-Event. Das Hook-Skript muss dafür nichts umbauen und braucht kein `jq`.
 */
export function claudeCodeHookToEvent(raw: unknown): TaubeEventInput {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const event = str(input.hook_event_name) ?? "Unknown";
  const project = projectFromCwd(str(input.cwd));
  const session = str(input.session_id);
  const message = str(input.message);
  const lastMessage = str(input.last_assistant_message);
  const where = project ? ` in ${project}` : "";

  const base = {
    source: "claude-code",
    agent: "claude-code",
    ...(project ? { project: truncate(project, LIMITS.context) } : {}),
    ...(session ? { session: truncate(session, LIMITS.context), group_key: `claude-code:${session}` } : {}),
  };

  switch (event) {
    case "Notification": {
      const kind = str(input.notification_type);
      const isPermission = kind === "permission_prompt" || /permission|erlaubnis/i.test(message ?? "");
      return {
        ...base,
        type: "claude_code.notification",
        title: truncate(message ?? `Claude Code wartet auf dich${where}`, LIMITS.title),
        ...(str(input.title) ? { body: str(input.title) } : {}),
        priority: isPermission ? 4 : 3,
        needs_input: true,
        tags: ["claude-code", isPermission ? "freigabe" : "wartet"],
      };
    }
    case "Stop":
      return {
        ...base,
        type: "claude_code.stop",
        title: `Claude Code ist fertig${where}`,
        ...(lastMessage ? { body: truncate(lastMessage, 4000) } : {}),
        priority: 3,
        needs_input: false,
        tags: ["claude-code", "fertig"],
      };
    case "SubagentStop":
      return {
        ...base,
        type: "claude_code.subagent_stop",
        title: `Subagent ${str(input.agent_type) ?? ""} ist fertig${where}`.replace(/\s+/g, " "),
        ...(lastMessage ? { body: truncate(lastMessage, 4000) } : {}),
        priority: 2,
        needs_input: false,
        tags: ["claude-code", "subagent"],
      };
    default:
      return {
        ...base,
        type: `claude_code.${event.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
        title: truncate(message ?? `Claude Code: ${event}${where}`, LIMITS.title),
        priority: 2,
        tags: ["claude-code"],
      };
  }
}
