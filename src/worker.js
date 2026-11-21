// Ward 27 campaign site: serves the pages, stores feedback in D1, password-protected admin API.
// __INDEX_HTML__ and __ADMIN_HTML__ are filled in by build.py
const INDEX_HTML = "__INDEX_HTML__";
const ADMIN_HTML = "__ADMIN_HTML__";

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const html = (s, extra = {}) =>
  new Response(s, { headers: { "content-type": "text/html; charset=utf-8", ...extra } });

async function sha(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return new Uint8Array(d);
}
async function same(a, b) {
  const x = await sha(a), y = await sha(b);
  let r = 0;
  for (let i = 0; i < x.length; i++) r |= x[i] ^ y[i];
  return r === 0;
}
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, "0")).join("");
const clean = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);

async function authed(req, env) {
  const given = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  if (!given || !env.ADMIN_PASSWORD) return false;
  if (await same(given, env.ADMIN_PASSWORD)) return true;
  await new Promise((r) => setTimeout(r, 800));
  return false;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/" || p === "/index.html") return html(INDEX_HTML, { "cache-control": "public, max-age=300" });
    if (p === "/admin" || p === "/admin/") return html(ADMIN_HTML, { "cache-control": "no-store", "x-robots-tag": "noindex" });

    if (p === "/api/feedback" && req.method === "POST") {
      let b;
      try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
      if (b.website) return json({ ok: true }); // honeypot
      const message = clean(b.message, 1500);
      if (!message) return json({ ok: false, error: "empty" }, 400);
      const sectors = ["38-W", "39", "40"], types = ["suggestion", "complaint", "support", "volunteer"];
      const sector = sectors.includes(b.sector) ? b.sector : "";
      const type = types.includes(b.type) ? b.type : "suggestion";
      const ip = req.headers.get("cf-connecting-ip") || "";
      const ipHash = hex(await sha("w27|" + ip)).slice(0, 16);
      const now = Date.now();
      const recent = await env.DB.prepare("SELECT COUNT(*) c FROM feedback WHERE ip_hash=? AND created_at>?").bind(ipHash, now - 10 * 60 * 1000).first();
      if (recent && recent.c >= 5) return json({ ok: false, error: "slow_down" }, 429);
      await env.DB.prepare("INSERT INTO feedback (name,phone,sector,type,message,created_at,ip_hash) VALUES (?,?,?,?,?,?,?)")
        .bind(clean(b.name, 80), clean(b.phone, 20), sector, type, message, now, ipHash).run();
      return json({ ok: true });
    }

    if (p.startsWith("/api/admin/")) {
      if (!(await authed(req, env))) return json({ ok: false, error: "unauthorized" }, 401);
      if (p === "/api/admin/list" && req.method === "GET") {
        const r = await env.DB.prepare("SELECT id,name,phone,sector,type,message,created_at,is_read FROM feedback ORDER BY created_at DESC LIMIT 1000").all();
        return json({ ok: true, rows: r.results });
      }
      if (req.method === "POST") {
        let b = {}; try { b = await req.json(); } catch {}
        const id = Number(b.id);
        if (!Number.isInteger(id)) return json({ ok: false, error: "bad_id" }, 400);
        if (p === "/api/admin/read") await env.DB.prepare("UPDATE feedback SET is_read=? WHERE id=?").bind(b.read ? 1 : 0, id).run();
        else if (p === "/api/admin/delete") await env.DB.prepare("DELETE FROM feedback WHERE id=?").bind(id).run();
        else return json({ ok: false, error: "not_found" }, 404);
        return json({ ok: true });
      }
    }
    return new Response("Not found", { status: 404 });
  },
};
