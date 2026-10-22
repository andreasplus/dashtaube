import { LIMITS } from "@dashtaube/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { getSourceRow } from "./db.js";
import { appVersion, type Env, type McpProps } from "./env.js";
import { ingest } from "./ingest.js";

/**
 * Remote-MCP-Server (Streamable HTTP, zustandslos). ChatGPT, Claude und andere KIs
 * verbinden sich per OAuth und melden sich mit `post_notification` in deiner Inbox.
 * Tool-Namen und Schemas bleiben stabil, damit verbundene KIs nicht brechen.
 */
function buildServer(env: Env, ctx: ExecutionContext, props: McpProps, origin: string): McpServer {
  const server = new McpServer(
    { name: "dashtaube", title: "Dashtaube", version: appVersion(env) },
    {
      jsonSchemaValidator: new CfWorkerJsonSchemaValidator(),
      instructions:
        "Dashtaube ist die Inbox des Nutzers für Meldungen von KI-Agenten. Nutze post_notification, wenn du eine " +
        "Aufgabe abgeschlossen hast, auf eine Entscheidung oder Freigabe wartest oder etwas Wichtiges passiert ist. " +
        "Schreib kurz und konkret, Titel in einer Zeile, Details als Markdown im Text.",
    },
  );

  server.registerTool(
    "post_notification",
    {
      title: "Meldung an Dashtaube schicken",
      description:
        "Schickt eine Meldung in die Dashtaube-Inbox des Nutzers. Setze needs_input auf true, wenn du auf eine " +
        "Antwort oder Freigabe wartest. Priorität 1 = nebenbei, 3 = normal, 5 = dringend.",
      inputSchema: {
        title: z.string().min(1).max(LIMITS.title).describe("Kurzer Titel, eine Zeile."),
        body: z.string().max(LIMITS.body).optional().describe("Details als Markdown."),
        priority: z.number().int().min(1).max(5).optional().describe("1 (niedrig) bis 5 (dringend), Standard 3."),
        tags: z.array(z.string().max(LIMITS.tag)).max(LIMITS.tags).optional().describe("Schlagwörter, z. B. deploy."),
        url: z.string().max(LIMITS.url).optional().describe("Link zu Ergebnis, Chat oder Pull Request (https)."),
        project: z.string().max(LIMITS.context).optional().describe("Projekt oder Repository, um das es geht."),
        session: z.string().max(LIMITS.context).optional().describe("Kennung des Chats oder Laufs."),
        needs_input: z.boolean().optional().describe("true, wenn du auf den Nutzer wartest."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async (args) => {
      const source = await getSourceRow(env.DB, props.sourceId);
      if (!source) {
        return {
          isError: true,
          content: [{ type: "text", text: "Diese Verbindung wurde in Dashtaube entfernt. Verbinde dich neu." }],
        };
      }
      const result = await ingest(env, ctx, {
        sourceId: source.id,
        input: { ...args, agent: props.clientName, source: "mcp" },
        via: "push",
        origin,
      });
      if (!result.ok) {
        return { isError: true, content: [{ type: "text", text: `Meldung ungültig: ${result.errors.join("; ")}` }] };
      }
      return {
        content: [{ type: "text", text: `Gemeldet. Die Meldung ist in Dashtaube unter ${result.url} zu sehen.` }],
        structuredContent: { id: result.id, url: result.url },
      };
    },
  );

  return server;
}

/** Wird vom OAuthProvider nur mit gültigem Access-Token aufgerufen; `ctx.props` enthält die Verbindung. */
export const mcpHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext & { props: McpProps }): Promise<Response> {
    if (request.method === "GET" || request.method === "DELETE") {
      // Zustandslos: kein SSE-Stream und keine Sitzungen.
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }
    const server = buildServer(env, ctx, ctx.props, new URL(request.url).origin);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    return transport.handleRequest(request);
  },
};
