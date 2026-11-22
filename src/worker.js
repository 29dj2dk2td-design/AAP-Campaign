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

const SESSION_SECONDS = 12 * 60 * 60;
async function sign(env, payload) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("w27-session|" + env.ADMIN_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
}
function cookieOf(req, name) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return m ? m[1] : "";
}
async function authed(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const [exp, sig] = cookieOf(req, "w27s").split(".");
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return same(sig, await sign(env, exp));
}
const cookieHeader = (v, age) => `w27s=${v}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${age}`;

async function rateOk(env, ipHash, kind, limit, windowMs) {
  const now = Date.now();
  const r = await env.DB.prepare("SELECT COUNT(*) c FROM rate WHERE ip_hash=? AND kind=? AND ts>?").bind(ipHash, kind, now - windowMs).first();
  if (r && r.c >= limit) return false;
  await env.DB.prepare("INSERT INTO rate (ip_hash,kind,ts) VALUES (?,?,?)").bind(ipHash, kind, now).run();
  if (Math.random() < 0.02) await env.DB.prepare("DELETE FROM rate WHERE ts<?").bind(now - 24 * 3600 * 1000).run();
  return true;
}
const likeEsc = (s) => s.replace(/[\\%_]/g, (m) => "\\" + m);
const VOTER_FIELDS = "name,relative,age,gender,sector,part,serial,booth,booth_address";

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/" || p === "/index.html") return html(INDEX_HTML, { "cache-control": "no-cache" });
    if (p === "/admin" || p === "/admin/") return html(ADMIN_HTML, { "cache-control": "no-store", "x-robots-tag": "noindex" });

    if (p === "/api/voters/info" && req.method === "GET") {
      const r = await env.DB.prepare("SELECT COUNT(*) c, SUM(epic_norm<>'') e, SUM(relative<>'') r, SUM(sector<>'') s FROM voters").first();
      return json({ ok: true, loaded: !!(r && r.c), epic: !!(r && r.e), relative: !!(r && r.r), sector: !!(r && r.s) }, 200);
    }
    if (p === "/api/voters/search" && req.method === "POST") {
      let b; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
      const total = await env.DB.prepare("SELECT COUNT(*) c FROM voters").first();
      if (!total || !total.c) return json({ ok: true, loaded: false, rows: [] });
      const ip = req.headers.get("cf-connecting-ip") || "";
      const ipHash = hex(await sha("w27|" + ip)).slice(0, 16);
      if (!(await rateOk(env, ipHash, "vsearch", 30, 10 * 60 * 1000))) return json({ ok: false, error: "slow_down" }, 429);
      const epic = clean(b.epic, 20).toUpperCase().replace(/\s+/g, "");
      if (epic) {
        const rows = (await env.DB.prepare(`SELECT ${VOTER_FIELDS} FROM voters WHERE epic_norm=? LIMIT 3`).bind(epic).all()).results;
        return json({ ok: true, loaded: true, rows, total: rows.length });
      }
      const name = clean(b.name, 60), rel = clean(b.relative, 60);
      const age = parseInt(b.age);
      const hasAge = Number.isInteger(age) && age >= 18 && age <= 120;
      if (name.length < 2 || (!hasAge && rel.length < 2)) return json({ ok: false, error: "need_more" }, 400);
      let where = "name LIKE ? ESCAPE '\\'";
      const args = ["%" + likeEsc(name) + "%"];
      if (rel.length >= 2) { where += " AND relative LIKE ? ESCAPE '\\'"; args.push("%" + likeEsc(rel) + "%"); }
      if (hasAge) { where += " AND age BETWEEN ? AND ?"; args.push(age - 1, age + 1); }
      const sector = ["38-W", "39", "40"].includes(b.sector) ? b.sector : "";
      if (sector) { where += " AND (sector=? OR sector='')"; args.push(sector); }
      const part = clean(b.part, 10);
      if (part) { where += " AND part=?"; args.push(part); }
      const cnt = await env.DB.prepare(`SELECT COUNT(*) c FROM voters WHERE ${where}`).bind(...args).first();
      const rows = (await env.DB.prepare(`SELECT ${VOTER_FIELDS} FROM voters WHERE ${where} ORDER BY name LIMIT 10`).bind(...args).all()).results;
      return json({ ok: true, loaded: true, rows, total: cnt ? cnt.c : rows.length });
    }

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

    if (p === "/api/admin/login" && req.method === "POST") {
      let b = {}; try { b = await req.json(); } catch {}
      if (env.ADMIN_PASSWORD && typeof b.password === "string" && (await same(b.password, env.ADMIN_PASSWORD))) {
        const exp = String(Date.now() + SESSION_SECONDS * 1000);
        const r = json({ ok: true });
        r.headers.append("set-cookie", cookieHeader(exp + "." + (await sign(env, exp)), SESSION_SECONDS));
        return r;
      }
      await new Promise((r) => setTimeout(r, 1000));
      return json({ ok: false, error: "unauthorized" }, 401);
    }
    if (p === "/api/admin/logout" && req.method === "POST") {
      const r = json({ ok: true });
      r.headers.append("set-cookie", cookieHeader("", 0));
      return r;
    }

    if (p.startsWith("/api/admin/")) {
      if (!(await authed(req, env))) return json({ ok: false, error: "unauthorized" }, 401);
      if (p === "/api/admin/voters/count" && req.method === "GET") {
        const c = await env.DB.prepare("SELECT COUNT(*) c FROM voters").first();
        return json({ ok: true, count: c.c });
      }
      if (p === "/api/admin/voters/import" && req.method === "POST") {
        let b = {}; try { b = await req.json(); } catch {}
        if (b.replace) await env.DB.prepare("DELETE FROM voters").run();
        const rows = Array.isArray(b.rows) ? b.rows.slice(0, 50) : [];
        const st = env.DB.prepare("INSERT INTO voters (epic,epic_norm,name,relative,age,gender,house,sector,part,serial,booth,booth_address) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
        const batch = [];
        for (const r of rows) {
          const name = clean(r.name, 100); if (!name) continue;
          const epic = clean(r.epic, 20);
          batch.push(st.bind(epic, epic.toUpperCase().replace(/\s+/g, ""), name, clean(r.relative, 100), parseInt(r.age) || null, clean(r.gender, 10), clean(r.house, 30), clean(r.sector, 20), clean(r.part, 20), clean(r.serial, 20), clean(r.booth, 150), clean(r.booth_address, 250)));
        }
        if (batch.length) await env.DB.batch(batch);
        return json({ ok: true, added: batch.length });
      }
      if (p === "/api/admin/voters/clear" && req.method === "POST") {
        await env.DB.prepare("DELETE FROM voters").run();
        return json({ ok: true });
      }
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
