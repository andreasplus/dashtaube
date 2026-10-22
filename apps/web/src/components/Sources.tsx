import type { Source, SourceKind } from "@dashtaube/core/notification";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { formatDate, t, type MessageKey } from "../i18n";
import { Header } from "./Header";

interface Secret {
  sourceId: string;
  kind: SourceKind;
  token?: string;
  signing_secret?: string;
  webhook_url?: string;
}

const KINDS: SourceKind[] = ["generic", "claude_code", "posttaube"];
const COLORS = ["#4f5bd5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#a855f7", "#64748b"];

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-field">
      <span className="muted small">{label}</span>
      <div>
        <code>{value}</code>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? t("sources.copied") : t("sources.copy")}
        </button>
      </div>
    </div>
  );
}

function Howto({ kind, token }: { kind: SourceKind; token: string }) {
  const base = location.origin;
  if (kind === "claude_code") {
    return (
      <pre className="code">{`export DASHTAUBE_URL=${base}
export DASHTAUBE_TOKEN=${token}
# Hook-Konfiguration: connectors/claude-code/README.md`}</pre>
    );
  }
  if (kind === "posttaube") return null;
  return (
    <pre className="code">{`curl -X POST ${base}/v1/notify \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Hallo von meinem Skript","priority":3}'`}</pre>
  );
}

export function Sources({ onLogout }: { onLogout: () => void }) {
  const [sources, setSources] = useState<Source[]>([]);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<SourceKind>("generic");
  const [icon, setIcon] = useState("");
  const [color, setColor] = useState(COLORS[0]!);
  const [secret, setSecret] = useState<Secret | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    api
      .sources()
      .then((r) => setSources(r.sources))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(reload, [reload]);

  const guard = async (fn: () => Promise<void>) => {
    setError(null);
    setMessage(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("error.generic"));
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    void guard(async () => {
      const result = await api.createSource({ name, kind, icon: icon || null, color });
      setSecret({ sourceId: result.id, kind, ...result });
      setName("");
      setIcon("");
      reload();
    });
  };

  const mcpUrl = `${location.origin}/mcp`;

  return (
    <div className="app">
      <Header active="sources" onLogout={onLogout} />
      <main className="page">
        <h1>{t("sources.title")}</h1>
        <p className="muted">{t("sources.intro")}</p>
        {error && <p className="error">{error}</p>}
        {message && <p className="notice">{message}</p>}

        <section className="card">
          <h2>{t("sources.mcpHeading")}</h2>
          <p className="muted">{t("sources.mcpText")}</p>
          <CopyField label="MCP" value={mcpUrl} />
        </section>

        <section className="card">
          <h2>{t("sources.new")}</h2>
          <form className="source-form" onSubmit={create}>
            <label>
              {t("sources.name")}
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} required />
            </label>
            <label>
              {t("sources.kind")}
              <select value={kind} onChange={(e) => setKind(e.target.value as SourceKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {t(`sources.kind.${k}` as MessageKey)}
                  </option>
                ))}
              </select>
            </label>
            <label className="narrow">
              {t("sources.icon")}
              <input value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={4} placeholder="🤖" />
            </label>
            <fieldset className="colors">
              <legend>{t("sources.color")}</legend>
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color ${c === color ? "active" : ""}`}
                  style={{ background: c }}
                  aria-label={c}
                  onClick={() => setColor(c)}
                />
              ))}
            </fieldset>
            <button className="primary" disabled={!name.trim()}>
              {t("sources.create")}
            </button>
          </form>
        </section>

        {secret && (
          <section className="card highlight">
            <p>
              <strong>{t("sources.secretOnce")}</strong>
            </p>
            {secret.token && <CopyField label={t("sources.token")} value={secret.token} />}
            {secret.webhook_url && <CopyField label={t("sources.webhookUrl")} value={secret.webhook_url} />}
            {secret.signing_secret && <CopyField label={t("sources.signingSecret")} value={secret.signing_secret} />}
            {secret.token && (
              <>
                <p className="muted small">{t("sources.howto")}</p>
                <Howto kind={secret.kind} token={secret.token} />
              </>
            )}
            <button onClick={() => setSecret(null)}>OK</button>
          </section>
        )}

        <section className="source-list">
          {sources.map((s) => (
            <div key={s.id} className="card source">
              <div className="source-head">
                <span className="swatch big" style={{ background: s.color ?? "var(--muted)" }} />
                {s.icon && <span className="source-icon">{s.icon}</span>}
                <div>
                  <h3>{s.name}</h3>
                  <p className="muted small">
                    {t(`sources.kind.${s.kind}` as MessageKey)} ·{" "}
                    {t("sources.count", { n: s.notification_count, u: s.unread_count })}
                    {s.kind !== "mcp" && (
                      <>
                        {" · "}
                        {s.token_last_used_at
                          ? t("sources.lastUsed", { date: formatDate(s.token_last_used_at) })
                          : t("sources.neverUsed")}
                        {s.token_prefix && <code className="small"> {s.token_prefix}…</code>}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="toolbar">
                <button
                  onClick={() =>
                    guard(async () => {
                      await api.testSource(s.id);
                      setMessage(t("sources.testSent"));
                      reload();
                    })
                  }
                >
                  {t("sources.test")}
                </button>
                {s.kind !== "mcp" && (
                  <button
                    onClick={() =>
                      confirm(t("sources.rotateConfirm")) &&
                      guard(async () => {
                        const { token } = await api.rotateToken(s.id);
                        setSecret({ sourceId: s.id, kind: s.kind, token });
                        reload();
                      })
                    }
                  >
                    {t("sources.rotateToken")}
                  </button>
                )}
                {s.kind === "posttaube" && (
                  <button
                    onClick={() =>
                      guard(async () => {
                        const result = await api.rotateSecret(s.id);
                        setSecret({ sourceId: s.id, kind: s.kind, ...result });
                      })
                    }
                  >
                    {t("sources.rotateSecret")}
                  </button>
                )}
                {s.kind === "mcp" && (
                  <button
                    onClick={() =>
                      confirm(t("sources.disconnectConfirm", { name: s.name })) &&
                      guard(async () => {
                        await api.disconnect(s.id);
                        setMessage(t("sources.disconnected"));
                      })
                    }
                  >
                    {t("sources.disconnect")}
                  </button>
                )}
                <button
                  className="danger"
                  onClick={() =>
                    confirm(t("sources.deleteConfirm", { name: s.name })) &&
                    guard(async () => {
                      await api.deleteSource(s.id);
                      reload();
                    })
                  }
                >
                  {t("sources.delete")}
                </button>
              </div>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
