// Stand-in for the Supabase client that talks to the MyFundedBook backend API (see config.js for its URL).
// Implements only what the journal front end calls.
(() => {
  const API = String(window.MFB_API_URL || "http://localhost:3000").replace(/\/+$/, "");
  const TK = "mfb.token";
  const getTok = () => { try { return localStorage.getItem(TK); } catch (e) { return null; } };
  const setTok = t => { try { t ? localStorage.setItem(TK, t) : localStorage.removeItem(TK); } catch (e) {} };

  async function call(method, url, body, raw) {
    try {
      const headers = {}, tok = getTok();
      if (tok) headers.Authorization = "Bearer " + tok;
      if (raw) headers["Content-Type"] = raw.type || "application/octet-stream"; else if (body !== undefined) headers["Content-Type"] = "application/json";
      const r = await fetch(API + url, { method, headers, body: raw || (body === undefined ? undefined : JSON.stringify(body)) });
      const j = await r.json().catch(() => ({}));
      return r.ok ? { data: j, error: null } : { data: null, error: { message: (j.error && j.error.message) || "Request failed" } };
    } catch (e) { return { data: null, error: { message: "Failed to fetch" } }; }
  }
  const listeners = [];
  const session = r => { if (r.error) return r; setTok(r.data.token); return { data: { session: { user: r.data.user }, user: r.data.user }, error: null }; };
  const auth = {
    async signUp({ email, password, options }) { return session(await call("POST", "/api/signup", { email, password, name: options && options.data && options.data.name })); },
    async signInWithPassword({ email, password }) { return session(await call("POST", "/api/login", { email, password })); },
    async signOut() { await call("POST", "/api/logout", {}); setTok(null); listeners.forEach(f => f("SIGNED_OUT")); return { error: null }; },
    async getSession() { if (!getTok()) return { data: { session: null } }; const r = await call("GET", "/api/me"); const u = r.data && r.data.user; if (!u) setTok(null); return { data: { session: u ? { user: u } : null } }; },
    onAuthStateChange(fn) { listeners.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
    async updateUser({ password }) { const r = await call("POST", "/api/password", { password }); return r.error ? r : { data: {}, error: null }; },
    async resetPasswordForEmail() { return { error: { message: "Password reset by email isn't available yet." } }; }
  };
  function table() {
    let pending = null;
    const t = {
      select() { pending = { kind: "select", off: 0, lim: 1000 }; return t; },
      order() { return t; },
      range(a, b) { pending.off = a; pending.lim = b - a + 1; return t; },
      async upsert(row) { const r = await call("PUT", "/api/journal", { col: row.col, id: row.id, data: row.data }); return { error: r.error }; },
      delete() { pending = { kind: "delete" }; return t; },
      match(m) { pending.m = m; return t; },
      then(res, rej) {
        const p = pending.kind === "select"
          ? call("GET", `/api/journal?offset=${pending.off}&limit=${pending.lim}`).then(r => ({ data: r.error ? null : r.data.rows, error: r.error }))
          : call("DELETE", `/api/journal/${pending.m.col}/${encodeURIComponent(pending.m.id)}`).then(r => ({ error: r.error }));
        return p.then(res, rej);
      }
    };
    return t;
  }
  const storage = { from: () => ({
    async upload(p, blob) { const r = await call("POST", "/api/images?path=" + encodeURIComponent(p), undefined, blob); return r.error ? { error: r.error } : { data: { path: p }, error: null }; },
    async createSignedUrl(p) { const r = await call("POST", "/api/images/sign", { path: p }); return r.error ? { data: null, error: r.error } : { data: { signedUrl: API + r.data.url }, error: null }; },
    async remove(paths) { for (const p of paths) await call("DELETE", "/api/images/" + p); return { error: null }; }
  }) };
  const client = { auth, from: () => table(), storage, channel() { const c = { on: () => c, subscribe: () => c }; return c; } };
  window.supabase = { createClient: () => client };
})();
