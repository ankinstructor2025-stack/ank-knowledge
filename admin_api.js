// admin_api.js
export function createApi({ API_BASE, state }) {
  async function apiFetch(path, { method = "GET", body = null } = {}) {
    if (!state.currentUser) throw new Error("not signed in");

    const token = await state.currentUser.getIdToken(true);
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== null) headers["Content-Type"] = "application/json";

    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      // body が null のときは送らない（GETでbody送信を避ける）
      body: body === null ? undefined : JSON.stringify(body),
    });

    const ct = res.headers.get("content-type") || "";
    const isJson = ct.includes("application/json");

    // 失敗時は JSON.detail / message を優先して読みやすくする
    if (!res.ok) {
      let msg = "";
      if (isJson) {
        const j = await res.json().catch(() => ({}));
        msg = j?.detail ?? j?.message ?? JSON.stringify(j);
      } else {
        msg = await res.text().catch(() => "");
      }
      throw new Error(`API error ${res.status}: ${msg}`);
    }

    if (isJson) return res.json();
    return await res.text().catch(() => "");
  }

  return { apiFetch };
}
