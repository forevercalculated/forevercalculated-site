import { getStore } from "@netlify/blobs";
import { json, adminOk } from "../lib/common.mjs";
import jobsMeta from "../lib/jobs-meta.mjs";
import jobsData from "../lib/jobs-data.mjs";

async function stripePayments() {
  const key = process.env.STRIPE_SECRET_KEY; if (!key) return [];
  const out = []; let after = "";
  for (let i = 0; i < 5; i++) {
    const r = await fetch("https://api.stripe.com/v1/checkout/sessions?limit=100&status=complete&expand[]=data.line_items" + after, { headers: { authorization: "Bearer " + key } });
    if (!r.ok) { console.error("stripe", r.status, await r.text()); break; }
    const d = await r.json();
    for (const s of d.data || []) {
      if (s.payment_status !== "paid") continue;
      const li = (s.line_items && s.line_items.data && s.line_items.data[0]) || {};
      out.push({ paid_at: new Date(s.created * 1000).toISOString(), service: li.description || "Payment", amount: ((s.amount_total || 0) / 100).toFixed(2), currency: String(s.currency || "").toUpperCase(), name: (s.customer_details && s.customer_details.name) || "", email: (s.customer_details && s.customer_details.email) || "" });
    }
    if (!d.has_more || !d.data.length) break;
    after = "&starting_after=" + d.data[d.data.length - 1].id;
  }
  return out;
}

async function all(name) {
  const store = getStore({ name, consistency: "strong" });
  const out = {};
  const page = await store.list();
  await Promise.all((page.blobs || []).map(async (b) => { const v = await store.get(b.key, { type: "json" }); if (v) out[b.key] = v; }));
  return out;
}
const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (rows, cols) => [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\n");

export default async (req) => {
  try {
    if (!adminOk(req)) return json({ error: "Not found" }, 404);
    const url = new URL(req.url);
    const view = url.searchParams.get("view") || "summary";
    const format = url.searchParams.get("format");
    if (view === "jobs") {
      // compact, filterable job list for matching (includes apply links)
      const q = (url.searchParams.get("q") || "").toLowerCase(), cc = url.searchParams.get("country") || "", cat = (url.searchParams.get("category") || "").toLowerCase();
      const work = url.searchParams.get("work") || "", limit = Math.min(Number(url.searchParams.get("limit")) || 200, 1000);
      const rows = jobsData.filter((j) => (!cc || j.country === cc) && (!cat || String(j.category).toLowerCase().includes(cat))
        && (!q || (j.title + " " + j.company + " " + j.category).toLowerCase().includes(q))
        && (!work || (work === "remote" ? /remote/i.test(j.location) || j.remote : work === "hybrid" ? /hybrid/i.test(j.location) : true)))
        .slice(0, limit).map((j) => ({ id: j.id, title: j.title, company: j.company, location: j.location, country: j.country, category: j.category, salary_min: j.salary_min, salary_max: j.salary_max, url: j.url }));
      return json({ refreshed: jobsMeta.refreshed, total: rows.length, rows });
    }
    if (view === "alerts") {
      // members who uploaded a CV and opted in to twice-daily job matches
      const cvs = getStore({ name: "cv-files", consistency: "strong" });
      const users = getStore({ name: "users", consistency: "strong" });
      const l = await cvs.list(); const out = [];
      await Promise.all((l.blobs || []).map(async (b) => {
        const m = ((await cvs.getMetadata(b.key)) || {}).metadata || {};
        if (m.alerts !== "yes") return;
        const u = (await users.get(b.key, { type: "json" })) || {};
        out.push({ key: b.key, email: m.email || u.email, first_name: u.firstName || "", country: u.country || "", city: u.city || "", industry: u.industry || "", work_pref: u.workPref || "", urgency: u.urgency || "", cv_name: m.name, cv_download: "/api/admin?view=cvfile&u=" + encodeURIComponent(b.key), opted_in: m.consentAt || m.uploadedAt });
      }));
      return json({ total: out.length, rows: out });
    }
    if (view === "cvfile") {
      const k = url.searchParams.get("u") || "";
      const got = await getStore({ name: "cv-files", consistency: "strong" }).getWithMetadata(k, { type: "arrayBuffer" });
      if (!got) return json({ error: "No CV" }, 404);
      const nm = (got.metadata && got.metadata.name) || "cv";
      return new Response(got.data, { headers: { "content-type": (got.metadata && got.metadata.type) || "application/octet-stream", "content-disposition": `attachment; filename="${nm.replace(/"/g, "")}"`, "cache-control": "no-store" } });
    }
    const wantPay = view === "summary" || view === "payments";
    const [users, activity, applies, cvs, payments] = await Promise.all([all("users"), all("activity"), all("apply-log"), all("cvs"), wantPay ? stripePayments().catch(() => []) : Promise.resolve([])]);
    const DAY = 86400000, now = Date.now();
    const cvFiles = {};
    try { const st = getStore({ name: "cv-files", consistency: "strong" }); const l = await st.list(); await Promise.all((l.blobs || []).map(async (b) => { const m = await st.getMetadata(b.key); cvFiles[b.key] = (m && m.metadata) || {}; })); } catch (e) { console.error("cv-files", e); }
    const nameOf = (k) => { const u = users[k] || {}; return { first_name: u.firstName || "", last_name: u.lastName || "" }; };

    const signups = Object.entries(users).map(([k, u]) => ({
      first_name: u.firstName || "", last_name: u.lastName || "", email: u.email, joined: u.createdAt || "",
      looking_in: [u.city, ({ ANY: "Anywhere (remote)", OTHER: "Other country" })[u.country] || u.country].filter(Boolean).join(", "), industry: u.industry || "", work_pref: ({ remote: "Remote", hybrid: "Hybrid", onsite: "On site", any: "Open to any" })[u.workPref] || "", urgency: ({ urgent: "Urgently (within 2 weeks)", month: "Within a month", quarter: "In 1 to 3 months", exploring: "Just exploring" })[u.urgency] || "",
      cv_file: cvFiles[k] ? (cvFiles[k].name || "yes") : "", key: k,
      last_active: (activity[k] && activity[k].lastSeen) || "",
      visits: (activity[k] && activity[k].visits) || 0, applications: (applies[k] && applies[k].events.length) || 0, cv_saved: cvs[k] ? "yes" : "no",
    })).sort((a, b) => String(b.joined).localeCompare(String(a.joined)));
    const events = [];
    Object.entries(applies).forEach(([k, r]) => (r.events || []).forEach((e) => events.push({ ...nameOf(k), email: r.email, role: e.title, company: e.company, location: e.location, country: e.country, applied_at: e.at })));
    events.sort((a, b) => String(b.applied_at).localeCompare(String(a.applied_at)));
    const cvList = Object.entries(cvs).map(([k, c]) => ({ ...nameOf(k), email: c.email, score: c.score, saved_at: c.savedAt, cv_text: c.text })).sort((a, b) => String(b.saved_at).localeCompare(String(a.saved_at)));

    if (view === "summary") {
      const since = (list, field, days) => list.filter((x) => x[field] && now - Date.parse(x[field]) < days * DAY).length;
      return json({
        signups: { total: signups.length, today: since(signups, "joined", 1), week: since(signups, "joined", 7), month: since(signups, "joined", 30) },
        applications: { total: events.length, today: since(events, "applied_at", 1), week: since(events, "applied_at", 7) },
        active_week: since(signups, "last_active", 7), cvs: cvList.length, urgent: signups.filter((x) => x.urgency.startsWith("Urgently")).length,
        payments: { total: payments.length, month: since(payments, "paid_at", 30), revenue_month: Object.entries(payments.filter((p) => now - Date.parse(p.paid_at) < 30 * DAY).reduce((a, p) => { a[p.currency] = (a[p.currency] || 0) + Number(p.amount); return a; }, {})).map(([c, v]) => c + " " + v.toFixed(2)).join(", ") || "0" },
        jobs: jobsMeta,
      });
    }
    const map = {
      signups: [signups, ["first_name", "last_name", "email", "joined", "looking_in", "industry", "work_pref", "urgency", "cv_file", "last_active", "visits", "applications", "cv_saved"]],
      applications: [events, ["first_name", "last_name", "email", "role", "company", "location", "country", "applied_at"]],
      cvs: [cvList, ["first_name", "last_name", "email", "score", "saved_at", "cv_text"]],
      payments: [payments, ["paid_at", "service", "amount", "currency", "name", "email"]],
    };
    if (!map[view]) return json({ error: "Unknown view" }, 400);
    const [rows, cols] = map[view];
    if (format === "csv") {
      return new Response("\ufeff" + toCsv(rows, cols), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="forever-careers-${view}-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" } });
    }
    return json({ rows });
  } catch (err) {
    console.error(err);
    return json({ error: String((err && err.message) || err) }, 500);
  }
};

export const config = { path: "/api/admin" };
