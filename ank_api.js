export const API_BASE = "https://ank-admin-api-986862757498.asia-northeast1.run.app";

export async function apiFetch(currentUser, path, { method = "GET", body = null } = {}) {
  if (!currentUser) throw new Error("not signed in");

  const token = await currentUser.getIdToken(true);
  const headers = { Authorization: `Bearer ${token}` };
  if (body != null) headers["Content-Type"] = "application/json";

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    // body が null のときは送らない
    body: body == null ? undefined : JSON.stringify(body),
  });

  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");

  const payload = isJson
    ? await res.json().catch(() => ({}))
    : await res.text().catch(() => "");

  if (!res.ok) {
    const msg =
      typeof payload === "string"
        ? payload
        : (payload.detail || payload.message || JSON.stringify(payload));
    throw new Error(`API error ${res.status}: ${msg}`);
  }

  return payload;
}
