import { retryFetch } from "../utils/retry.js";

const BASE = "https://api.revenuecat.com/v2";

function authHeaders(): Record<string, string> {
  const key = process.env.RC_SECRET_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error(
      "RC_SECRET_KEY is not set. Create a v2 Secret API Key in RevenueCat → Project Settings → API Keys."
    );
  }
  if (!key.startsWith("sk_")) {
    // The v1 public/mobile keys start with pub_/app_/ios_ and lack read access
    // to other customers. Catch that early instead of returning 401 on every call.
    throw new Error(
      `RC_SECRET_KEY must be a v2 Secret Key (starts with sk_). Got a key that starts with "${key.slice(0, 4)}...".`
    );
  }
  return { Authorization: `Bearer ${key.trim()}`, Accept: "application/json" };
}

async function bodyPreview(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, 500);
  } catch {
    return "<unreadable body>";
  }
}

export async function rcGet<T>(path: string): Promise<T> {
  const res = await retryFetch(() =>
    fetch(`${BASE}${path}`, { headers: authHeaders() })
  );
  if (!res.ok) {
    const preview = await bodyPreview(res);
    throw new Error(`RevenueCat ${res.status} ${res.statusText} on ${path}: ${preview}`);
  }
  return (await res.json()) as T;
}

export function defaultProjectId(): string {
  const id = process.env.RC_DEFAULT_PROJECT_ID;
  if (!id || id.trim().length === 0) {
    throw new Error(
      "RC_DEFAULT_PROJECT_ID is not set and no project_id was provided. " +
        "Call rc_list_projects to discover ids, or pass project_id explicitly."
    );
  }
  return id.trim();
}
