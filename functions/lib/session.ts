import type { Env } from "./env";

const COOKIE_NAME = "cv_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

interface SessionPayload {
  userId: string;
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacSign(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function cookieAttributes(request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? " Secure;" : "";
  return `Path=/; HttpOnly;${secure} SameSite=Strict`;
}

/** Signs a session cookie for the given user. Throws if SESSION_SECRET isn't configured — fails
 * closed rather than issuing an unsigned/forgeable cookie. */
export async function createSessionCookie(userId: string, request: Request, env: Env): Promise<string> {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured.");
  const payload: SessionPayload = { userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sigB64 = base64UrlEncode(await hmacSign(env.SESSION_SECRET, payloadB64));
  return `${COOKIE_NAME}=${payloadB64}.${sigB64}; ${cookieAttributes(request)}; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie(request: Request): string {
  return `${COOKIE_NAME}=; ${cookieAttributes(request)}; Max-Age=0`;
}

/** Returns the authenticated user id, or null if there's no cookie, the signature doesn't match,
 * it's expired, or SESSION_SECRET isn't configured (fails closed — nobody is "logged in" without it). */
export async function verifySession(request: Request, env: Env): Promise<string | null> {
  if (!env.SESSION_SECRET) return null;

  const cookieHeader = request.headers.get("cookie") ?? "";
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const [payloadB64, sigB64] = match[1].split(".");
  if (!payloadB64 || !sigB64) return null;

  const expectedSig = await hmacSign(env.SESSION_SECRET, payloadB64);
  let actualSig: Uint8Array;
  try {
    actualSig = base64UrlDecode(sigB64);
  } catch {
    return null;
  }
  if (expectedSig.length !== actualSig.length) return null;
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) diff |= expectedSig[i] ^ actualSig[i];
  if (diff !== 0) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64))) as SessionPayload;
    if (typeof payload.userId !== "string" || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.userId;
  } catch {
    return null;
  }
}
