import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { json, adminOk, normEmail, isEmail, userKey } from "../lib/common.mjs";

// The Forever Times newsletter: subscribe, unsubscribe, and an admin list for the Sunday send.
const COUNTRIES = { UK: "United Kingdom", US: "United States", CA: "Canada", AU: "Australia", NZ: "New Zealand", SG: "Singapore", ZA: "South Africa", IN: "India", DE: "Germany", FR: "France", NL: "Netherlands", ES: "Spain", IT: "Italy", BE: "Belgium", AT: "Austria", CH: "Switzerland", PL: "Poland", BR: "Brazil", MX: "Mexico" };
const SITE = "https://forevercalculatedcareers.com";
const page = (t, m) => new Response(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t}</title><body style="font-family:-apple-system,Segoe UI,Arial,sans-serif;background:#0A0D0C;color:#F2F5F3;display:grid;place-items:center;min-height:100vh;margin:0"><div style="max-width:440px;padding:32px;text-align:center"><h1 style="font-family:Georgia,serif">${t}</h1><p style="color:#AEB8B3;line-height:1.5">${m}</p><p><a href="${SITE}" style="color:#FF8A7A">Back to Forever Careers</a></p></div>`, { headers: { "content-type": "text/html; charset=utf-8" } });

export default async (req) => {
  const store = getStore({ name: "newsletter", consistency: "strong" });
  const url = new URL(req.url);
  if (req.method === "GET") {
    const u = url.searchParams.get("u"), t = url.searchParams.get("t");
    if (u && t) {
      const s = await store.get(u, { type: "json" });
      if (!s || !s.token || s.token.length !== t.length || !crypto.timingSafeEqual(Buffer.from(s.token), Buffer.from(t))) return page("Link not recognised", "This unsubscribe link has expired or is incorrect. Reply to any Forever Times email and we'll remove you.");
      s.status = "unsubscribed"; s.unsubscribedAt = new Date().toISOString(); await store.setJSON(u, s);
      return page("You're unsubscribed", "You won't receive The Forever Times any more. You can resubscribe any time on our Newsletter page.");
    }
    if (url.searchParams.get("list") && adminOk(req)) {
      const out = []; const pg = await store.list();
      await Promise.all((pg.blobs || []).map(async (b) => { const v = await store.get(b.key, { type: "json" }); if (v && v.status === "active") out.push({ id: b.key, firstName: v.firstName, email: v.email, countries: v.countries, subscribedAt: v.createdAt, unsubscribeUrl: `${SITE}/api/newsletter?u=${b.key}&t=${v.token}` }); }));
      return json({ count: out.length, subscribers: out, countries: COUNTRIES });
    }
    return json({ error: "not found" }, 404);
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  let b; try { b = await req.json(); } catch { return json({ error: "Please try again." }, 400); }
  if (b.website) return json({ ok: true });
  const email = normEmail(b.email), first = String(b.first_name || "").trim().slice(0, 60);
  const countries = [...new Set((Array.isArray(b.countries) ? b.countries : []).map(String))].filter((c) => COUNTRIES[c]);
  if (!first) return json({ error: "Please add your first name." }, 400);
  if (!isEmail(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!countries.length) return json({ error: "Please choose at least one country." }, 400);
  if (b.consent !== true) return json({ error: "Please tick the box to agree to receive The Forever Times." }, 400);
  const key = userKey(email); const prev = (await store.get(key, { type: "json" })) || {};
  const now = new Date().toISOString();
  await store.setJSON(key, { ...prev, firstName: first, email, countries, status: "active", consentAt: now, createdAt: prev.createdAt || now, updatedAt: now, token: prev.token || crypto.randomBytes(16).toString("hex"), source: "newsletter-page" });
  return json({ ok: true });
};
export const config = { path: "/api/newsletter" };
