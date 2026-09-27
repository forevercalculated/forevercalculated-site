import { getStore } from "@netlify/blobs";

// Anonymous visit counter: no names, emails, IP addresses or cross-site tracking. Totals only.
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|headless|lighthouse|monitor|curl|wget|python/i;
const clean = (s, n = 40) => String(s || "").toLowerCase().replace(/[^a-z0-9.\-_ ]/g, "").slice(0, n);

export default async (req, context) => {
  const ok = new Response(null, { status: 204 });
  try {
    if (req.method !== "POST") return ok;
    const ua = req.headers.get("user-agent") || "";
    if (!ua || BOT.test(ua)) return ok;
    const body = await req.json().catch(() => ({}));
    const view = clean(body.v, 30) || "home";
    let src = clean(body.s, 40) || "direct";
    if (/instagram/i.test(ua)) src = "instagram";
    const device = /mobile|iphone|android(?!.*tablet)/i.test(ua) ? "phone" : /ipad|tablet/i.test(ua) ? "tablet" : "computer";
    const country = clean(context?.geo?.country?.code || req.headers.get("x-country") || "unknown", 8).toUpperCase() || "UNKNOWN";
    const day = new Date().toISOString().slice(0, 10);
    const store = getStore({ name: "visits", consistency: "strong" });
    const rec = (await store.get(day, { type: "json" })) || { views: 0, uniques: 0, pages: {}, sources: {}, devices: {}, countries: {} };
    const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
    rec.views++;
    inc(rec.pages, view);
    if (body.n === true) { rec.uniques++; inc(rec.sources, src); inc(rec.devices, device); inc(rec.countries, country); }
    await store.setJSON(day, rec);
    return ok;
  } catch (e) {
    console.error("visit", e);
    return ok;
  }
};

export const config = { path: "/api/visit" };
