import { readFile } from "node:fs/promises";
import { SignJWT, importPKCS8, type KeyLike } from "jose";

/**
 * App Store Connect uses short-lived JWTs (ES256, 20 min max lifetime).
 * We generate one that lives for 19 minutes and reuse it until the last
 * minute — that keeps stdio latency low without ever handing Apple a token
 * that's about to expire mid-request.
 */

let cachedKey: KeyLike | null = null;
let cachedToken: { jwt: string; expiresAt: number } | null = null;

function readEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim().length === 0) {
    throw new Error(
      `${name} is not set. See README section 4 (claude_desktop_config env block).`
    );
  }
  return v.trim();
}

async function loadPrivateKey(): Promise<KeyLike> {
  if (cachedKey) return cachedKey;
  const path = readEnv("ASC_PRIVATE_KEY_PATH");
  if (!path.endsWith(".p8")) {
    // The Apple key file always ends in .p8. Cheap check that catches the
    // common "pointed it at the wrong file" mistake before jose blows up.
    throw new Error(
      `ASC_PRIVATE_KEY_PATH should point to a .p8 file (got: ${path})`
    );
  }
  let pem: string;
  try {
    pem = await readFile(path, "utf-8");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not read ASC private key at ${path}: ${msg}`);
  }
  if (!pem.includes("BEGIN PRIVATE KEY")) {
    throw new Error(
      `File at ${path} does not look like a PKCS8 PEM. Re-download from App Store Connect.`
    );
  }
  cachedKey = (await importPKCS8(pem, "ES256")) as KeyLike;
  return cachedKey;
}

/**
 * Returns a valid App Store Connect JWT. Cached until it's within 60s of
 * expiry so we don't spin up a new signature on every call.
 */
export async function getAscToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - now > 60) {
    return cachedToken.jwt;
  }

  const keyId = readEnv("ASC_KEY_ID");
  const issuerId = readEnv("ASC_ISSUER_ID");
  const privateKey = await loadPrivateKey();
  const expiresAt = now + 19 * 60;

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: keyId, typ: "JWT" })
    .setIssuer(issuerId)
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setAudience("appstoreconnect-v1")
    .sign(privateKey);

  cachedToken = { jwt, expiresAt };
  return jwt;
}

export function getVendorNumber(): string {
  return readEnv("ASC_VENDOR_NUMBER");
}
