import crypto from "node:crypto";
import { json, emailFromRequest, adminOk, normEmail, isEmail, userKey } from "../lib/common.mjs";
import { getStore } from "@netlify/blobs";
import { sendEmail } from "../lib/billing.mjs";
import { QUESTIONS, REQUEST_DAYS, DAY, getRequest, setRequest, isOpen, responses, requests, wipeUser } from "../lib/feedback.mjs";

const nice = (s) => String(s || "").toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
const clean = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);

const NOTIFY_TO = "forevercalculated@gmail.com";
const h = (v) => String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
function responseEmail(rec) {
  const who = `${rec.firstName}${rec.lastInitial ? " " + rec.lastInitial + "." : ""}`;
  const rows = QUESTIONS.map((q, i) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #eee;color:#555;vertical-align:top;width:52%">${i + 1}. ${h(q.text)}</td><td style="padding:8px 10px;border-bottom:1px solid #eee;font-weight:600;vertical-align:top">${h(rec.answers[q.id])}</td></tr>`).join("");
  const block = (title, text) => text ? `<p style="margin:18px 0 4px;font-weight:700">${title}</p><div style="background:#f6f6f8;border-radius:8px;padding:10px 12px;white-space:pre-wrap">${h(text)}</div>` : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#111;max-width:640px">
<h2 style="margin:0 0 6px">${rec.test ? "[TEST] " : ""}New exit feedback from ${h(who)}</h2>
<p style="margin:0 0 14px;color:#555">${h(rec.country || "Country not given")}${rec.industry ? " · " + h(rec.industry) : ""} · submitted ${h(new Date(rec.submittedAt).toLocaleString("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }))} UK time</p>
<p style="font-size:18px;margin:0 0 14px"><b>Overall rating: ${rec.rating}/10</b></p>
<table style="border-collapse:collapse;width:100%;font-size:14px">${rows}</table>
${block("Other reason for cancelling", rec.otherReason)}
${block("Further comments", rec.comments)}
${rec.testimonialConsent ? block("Testimonial (permission given to use with first name, surname initial and country)", rec.testimonial) : `<p style="margin:18px 0 0;color:#555">No testimonial permission given.</p>`}
<p style="margin:22px 0 0;color:#888;font-size:12px">The member's account and personal details have been deleted. All responses: https://forevercalculatedcareers.com/api/feedback?action=list (admin key needed).</p></div>`;
  return { subject: `${rec.test ? "[TEST] " : ""}Exit feedback: ${who}, ${rec.rating}/10`, html };
}

async function admin(req, url) {
  const action = url.searchParams.get("action") || "list";
  if (action === "request" && req.method === "POST") {
    const email = normEmail(url.searchParams.get("email"));
    if (!isEmail(email)) return json({ error: "email required" }, 400);
    const u = await getStore({ name: "users", consistency: "strong" }).get(userKey(email), { type: "json" });
    if (!u) return json({ error: "No account found for this email." }, 404);
    const days = Math.min(60, Math.max(1, Number(url.searchParams.get("days")) || REQUEST_DAYS));
    const now = Date.now();
    const r = await setRequest(email, { email, firstName: nice(u.firstName), status: "pending", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + days * DAY).toISOString(), wipeAfter: true, test: url.searchParams.get("test") === "1" });
    return json({ ok: true, request: r, url: "https://forevercalculatedcareers.com/feedback/" });
  }
  if (action === "list") {
    const s = responses(); const { blobs } = await s.list();
    const out = [];
    const withTests = url.searchParams.get("tests") === "1";
    for (const b of blobs || []) { if (!withTests && b.key.startsWith("test-")) continue; const v = await s.get(b.key, { type: "json" }); if (v) out.push(v); }
    out.sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));
    const rq = requests(); const rl = await rq.list(); const reqs = [];
    for (const b of rl.blobs || []) { const v = await rq.get(b.key, { type: "json" }); if (v) reqs.push({ status: v.status, firstName: v.firstName, createdAt: v.createdAt, expiresAt: v.expiresAt, email: v.status === "pending" ? v.email : undefined }); }
    return json({ questions: QUESTIONS, responses: out, requests: reqs });
  }
  return json({ error: "Unknown action" }, 400);
}

async function handle(req) {
  const url = new URL(req.url);
  if (adminOk(req)) return admin(req, url);
  const email = emailFromRequest(req);
  if (!email) return json({ error: "Please sign in to continue.", signIn: true }, 401);
  const r = await getRequest(email);
  if (!isOpen(r)) {
    const reason = r && r.status === "completed" ? "completed" : r && r.status === "pending" ? "expired" : "none";
    return json({ eligible: false, reason }, req.method === "POST" ? 403 : 200);
  }
  if (req.method === "GET") return json({ eligible: true, firstName: r.firstName || "", questions: QUESTIONS, expiresAt: r.expiresAt });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body; try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
  const answers = {};
  for (const q of QUESTIONS) {
    const v = String((body.answers || {})[q.id] || "");
    if (!q.options.includes(v)) return json({ error: "Please answer every question before submitting." }, 400);
    answers[q.id] = v;
  }
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 10) return json({ error: "Please give us a rating out of 10." }, 400);
  const consent = body.consent === true;
  const testimonial = clean(body.testimonial, 1200);

  // Claim the single attempt first so a double click can't submit twice.
  const claimed = await setRequest(email, { status: "completed", completedAt: new Date().toISOString() });
  const users = getStore({ name: "users", consistency: "strong" });
  const u = (await users.get(userKey(email), { type: "json" })) || {};
  const record = {
    id: crypto.randomBytes(6).toString("hex"),
    submittedAt: new Date().toISOString(),
    firstName: claimed.firstName || nice(u.firstName),
    lastInitial: (u.lastName || "").slice(0, 1).toUpperCase(),
    country: u.country || "",
    industry: u.industry || "",
    answers, rating,
    otherReason: clean(body.otherReason, 300),
    comments: clean(body.comments, 1500),
    testimonial: consent ? testimonial : "",
    testimonialConsent: consent && !!testimonial,
    ...(claimed.test ? { test: true } : {}),
  };
  await responses().setJSON(`${claimed.test ? "test-" : ""}${Date.now()}-${record.id}`, record);
  try { await sendEmail({ to: NOTIFY_TO, ...responseEmail(record) }); } catch (e) { console.error("feedback notify", e); }
  let wiped = [];
  try { wiped = await wipeUser(email); } catch (e) { console.error("feedback wipe", e); }
  // Keep only a minimal marker (no email address) so the request can't be reused.
  await requests().setJSON(userKey(email), { status: "completed", firstName: record.firstName, completedAt: record.submittedAt, wiped: wiped.length });
  return json({ ok: true, firstName: record.firstName });
}

export default async (req) => {
  try { return await handle(req); }
  catch (err) { console.error(err); return json({ error: "Something went wrong. Please try again." }, 500); }
};
export const config = { path: "/api/feedback" };
