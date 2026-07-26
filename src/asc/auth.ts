import { readFile } from "node:fs/promises";
import { SignJWT, importPKCS8, type KeyLike } from "jose";

let cachedKey: KeyLike | null = null;
let cachedToken: { jwt: string; expiresAt: number } | null = null;

async function getPrivateKey(): Promise<KeyLike> {
  if (cachedKey) return cachedKey;
  const path = process.env.ASC_PRIVATE_KEY_PATH;
  if (!path) {
    throw new Error("ASC_PRIVATE_KEY_PATH is not set");
  }
  const pem = await readFile(path, "utf-8");
  cachedKey = (await importPKCS8(pem, "ES256")) as KeyLike;
  return cachedKey;
}

/**
 * Returns a valid App Store Connect JWT (ES256).
 * Apple allows a max lifetime of 20 minutes — we use 19 and cache aggressively.
 */
export async function getAscToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - now > 60) {
    return cachedToken.jwt;
  }

  const keyId = process.env.ASC_KEY_ID;
  const issuerId = process.env.ASC_ISSUER_ID;
  if (!keyId || !issuerId) {
    throw new Error("ASC_KEY_ID and ASC_ISSUER_ID must be set");
  }

  const privateKey = await getPrivateKey();
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
