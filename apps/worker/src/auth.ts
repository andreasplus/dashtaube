import { bytesToBase64Url, randomBytes, sha256Hex, timingSafeEqual } from "@dashtaube/core";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { findSourceByTokenHash, getSourceRow, touchToken } from "./db.js";
import type { Env } from "./env.js";

export const SESSION_COOKIE = "dt_session";
const SESSION_DAYS = 30;
const MAX_FAILURES = 10;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

export type SourceRecord = NonNullable<Awaited<ReturnType<typeof getSourceRow>>>;

export type AppEnv = {
  Bindings: Env;
  Variables: { source: SourceRecord };
};

function clientIp(c: Context<AppEnv>): string {
  return c.req.header("cf-connecting-ip") ?? "local";
}

export type LoginResult = { ok: true } | { ok: false; status: 401 | 429 | 503; error: string };

/** Prüft das Passwort, legt bei Erfolg eine Sitzung an und setzt das Cookie. */
export async function login(c: Context<AppEnv>, password: string): Promise<LoginResult> {
  const expected = c.env.ADMIN_PASSWORD;
  if (!expected) {
    return { ok: false, status: 503, error: "ADMIN_PASSWORD ist nicht gesetzt. Lege es als Secret in Cloudflare an." };
  }
  const db = c.env.DB;
  const now = Date.now();
  const ip = clientIp(c);
  const failures = await db
    .prepare("SELECT count(*) AS n FROM login_failures WHERE ip = ? AND at > ?")
    .bind(ip, now - FAILURE_WINDOW_MS)
    .first<{ n: number }>();
  if ((failures?.n ?? 0) >= MAX_FAILURES) {
    return { ok: false, status: 429, error: "Zu viele Fehlversuche. Versuch es in 15 Minuten noch einmal." };
  }

  // Hashes vergleichen, damit die Länge des Passworts nichts verrät.
  if (!timingSafeEqual(await sha256Hex(password), await sha256Hex(expected))) {
    await db.batch([
      db.prepare("INSERT INTO login_failures (ip, at) VALUES (?, ?)").bind(ip, now),
      db.prepare("DELETE FROM login_failures WHERE at < ?").bind(now - FAILURE_WINDOW_MS),
    ]);
    return { ok: false, status: 401, error: "Das Passwort stimmt nicht." };
  }

  const sessionToken = bytesToBase64Url(randomBytes(32));
  const expiresAt = now + SESSION_DAYS * 24 * 60 * 60 * 1000;
  await db.batch([
    db
      .prepare("INSERT INTO sessions (id_hash, created_at, expires_at) VALUES (?, ?, ?)")
      .bind(await sha256Hex(sessionToken), now, expiresAt),
    db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM login_failures WHERE ip = ?").bind(ip),
  ]);
  setCookie(c, SESSION_COOKIE, sessionToken, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
  return { ok: true };
}

export async function logout(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare("DELETE FROM sessions WHERE id_hash = ?").bind(await sha256Hex(token)).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Prüft das Sitzungs-Cookie einer Anfrage. */
export async function hasSession(env: Env, cookieValue: string | undefined): Promise<boolean> {
  if (!cookieValue) return false;
  const row = await env.DB.prepare("SELECT expires_at FROM sessions WHERE id_hash = ?")
    .bind(await sha256Hex(cookieValue))
    .first<{ expires_at: number }>();
  return !!row && row.expires_at > Date.now();
}

/**
 * Dashboard-Routen: brauchen eine gültige Sitzung. Ändernde Anfragen müssen zusätzlich
 * vom eigenen Origin kommen (Schutz gegen CSRF, zusätzlich zu SameSite=Lax).
 */
export const requireSession: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!(await hasSession(c.env, getCookie(c, SESSION_COOKIE)))) {
    return c.json({ error: "Bitte melde dich an." }, 401);
  }
  const method = c.req.method;
  if (method !== "GET" && method !== "HEAD") {
    const origin = c.req.header("origin");
    if (origin !== new URL(c.req.url).origin) {
      return c.json({ error: "Anfrage von fremdem Origin abgelehnt." }, 403);
    }
  }
  await next();
};

/** API-Routen für Quellen: `Authorization: Bearer dt_…`. */
export const requireToken: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    return c.json({ error: "Token fehlt. Schicke den Header `Authorization: Bearer dt_…`." }, 401);
  }
  const found = await findSourceByTokenHash(c.env.DB, await sha256Hex(match[1]!));
  if (!found) return c.json({ error: "Token ist ungültig oder wurde ersetzt." }, 401);
  c.set("source", found.source);
  c.executionCtx.waitUntil(touchToken(c.env.DB, found.token_id));
  await next();
};
