const BASE = "https://api.revenuecat.com/v2";

function auth(): Record<string, string> {
  const key = process.env.RC_SECRET_KEY;
  if (!key) throw new Error("RC_SECRET_KEY is not set");
  return { Authorization: `Bearer ${key}`, Accept: "application/json" };
}

export async function rcGet<T = unknown>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: auth() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`RevenueCat ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

export function defaultProjectId(): string {
  const id = process.env.RC_DEFAULT_PROJECT_ID;
  if (!id) {
    throw new Error(
      "RC_DEFAULT_PROJECT_ID is not set and no project_id was provided. Call rc_list_projects first."
    );
  }
  return id;
}
