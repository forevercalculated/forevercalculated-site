// Exit survey for members who cancel: one attempt, then the account and personal details are wiped.
import { getStore } from "@netlify/blobs";
import { userKey, normEmail } from "./common.mjs";

export const DAY = 86400000;
export const REQUEST_DAYS = 14;
const st = (name) => getStore({ name, consistency: "strong" });
export const requests = () => st("feedback-requests");
export const responses = () => st("feedback");

// 10 multiple choice questions, then a rating out of 10, then optional comments and testimonial.
export const QUESTIONS = [
  { id: "q1", text: "What was the main reason you cancelled your membership?", options: ["The price", "I didn't receive enough roles that suited me", "The roles weren't open to people in my country", "I found a job", "I'm not actively looking right now", "Too many emails", "The website was hard to use", "Another reason"] },
  { id: "q2", text: "How well did the roles we sent match your experience and skills?", options: ["Very well", "Quite well", "Not very well", "Not at all", "I didn't receive any roles"] },
  { id: "q3", text: "How well did the roles match the location or remote working you wanted?", options: ["Very well", "Quite well", "Not very well", "Not at all"] },
  { id: "q4", text: "What did you think of the number of job emails (up to three a day)?", options: ["Too many", "About right", "Too few"] },
  { id: "q5", text: "How easy was our website to use?", options: ["Very easy", "Fairly easy", "Quite difficult", "Very difficult", "I didn't really use it"] },
  { id: "q6", text: "Did you apply for any of the roles we sent you?", options: ["Yes, several", "Yes, one or two", "No, none were right for me", "No, I didn't have time"] },
  { id: "q7", text: "Which part of Forever Careers was most useful to you?", options: ["CV matched job emails", "The job board", "The CV and career tools", "Personal support from the team", "None of them"] },
  { id: "q8", text: "How did you feel about the price of £19.99 a month?", options: ["Good value", "About right", "A little too high", "Much too high", "I didn't reach the paid stage"] },
  { id: "q9", text: "What would be most likely to bring you back in future?", options: ["A lower price", "More roles open to people in my country", "More senior or specialist roles", "Better matched roles", "Fewer emails", "Nothing, I'm happy as I am"] },
  { id: "q10", text: "Would you recommend Forever Careers to a friend who is looking for work?", options: ["Yes, definitely", "Probably", "Not sure", "Probably not", "Definitely not"] },
];

export async function getRequest(email) {
  return (await requests().get(userKey(normEmail(email)), { type: "json" })) || null;
}
export async function setRequest(email, patch) {
  const k = userKey(normEmail(email));
  const prev = (await requests().get(k, { type: "json" })) || {};
  const next = { ...prev, ...patch, updatedAt: new Date().toISOString() };
  await requests().setJSON(k, next);
  return next;
}
export const isOpen = (r, now = Date.now()) => !!(r && r.status === "pending" && Date.parse(r.expiresAt) > now);

async function stripeCall(method, path) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { method, headers: { authorization: `Bearer ${key}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${(data.error && data.error.message) || "error"}`);
  return data;
}

// Permanently removes a member's account and personal details from the site's stores and Stripe.
export async function wipeUser(email) {
  email = normEmail(email);
  const key = userKey(email);
  const done = [];
  const bill = (await st("billing").get(key, { type: "json" }).catch(() => null)) || null;
  const keyed = ["users", "activity", "applied-v2", "apply-log", "cvs", "cv-files", "billing", "students", "student-ids", "newsletter"];
  for (const n of keyed) { try { await st(n).delete(key); done.push(n); } catch (e) { console.error("wipe", n, e); } }
  // Stripe customers with this email (deleting a customer also cancels its subscriptions and removes saved payment methods)
  const cus = new Set(bill && bill.customerId ? [bill.customerId] : []);
  try {
    const list = await stripeCall("GET", `customers?email=${encodeURIComponent(email)}&limit=10`);
    for (const c of (list && list.data) || []) cus.add(c.id);
  } catch (e) { console.error("wipe stripe list", e); }
  for (const id of cus) {
    try { await st("billing").delete("cus:" + id); } catch (e) {}
    try { await stripeCall("DELETE", "customers/" + id); done.push("stripe:" + id); } catch (e) { console.error("wipe stripe", id, e); }
  }
  // Queued emails and chat hand offs that mention the email address
  for (const n of ["outbox", "chat-handoffs"]) {
    try {
      const s = st(n); const { blobs } = await s.list();
      for (const b of blobs || []) {
        const v = await s.get(b.key, { type: "text" }).catch(() => "");
        if (v && v.toLowerCase().includes(email)) { await s.delete(b.key); done.push(n + ":" + b.key); }
      }
    } catch (e) { console.error("wipe scan", n, e); }
  }
  return done;
}

// ---- automatic exit flow: used when a member's cancelled membership ends ----
const esc = (s) => String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const niceName = (s) => String(s || "").toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
export function exitEmail(firstName, expiresAt, kind = "cancelled") {
  const why = kind === "ended" ? "why you decided not to continue with us" : "why you decided to cancel";
  const n = esc(niceName(firstName));
  const hi = n ? `Hi ${n},` : "Hi there,";
  const until = new Date(expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
  const P = (t) => `<p style="margin:0 0 14px;">${t}</p>`;
  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#0B0912;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#0B0912;font-size:1px;line-height:1px;">Could you tell us why you cancelled? It takes about three minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0B0912" style="background:#0B0912;"><tr><td align="center" style="padding:16px 8px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
<tr><td style="padding:6px 8px 18px;font-family:'Space Grotesk',Arial,Helvetica,sans-serif;font-size:19px;font-weight:700;color:#FFFFFF;">Forever<span style="color:#5FE3B8;">Careers</span></td></tr>
<tr><td style="padding:0 8px 18px;"><h1 style="margin:0 0 8px;font-family:'Space Grotesk',Arial,Helvetica,sans-serif;font-size:28px;line-height:1.15;font-weight:700;color:#FFFFFF;">${n ? n + ", could" : "Could"} you tell us how we did?</h1></td></tr>
<tr><td style="padding:0 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#DCD8EA;">
${P(hi)}
${P("Your Forever Careers membership has now ended, so you won't receive any more job emails from us and you won't be charged. Thank you for giving us a try.")}
${P("I'd really value hearing " + why + ", so we can keep improving the service. I've put together a short feedback form of 10 multiple choice questions and a rating out of 10. It takes about three minutes. If anything went well for you, there's also space to share a few words as a testimonial, but only if you're happy for us to use them.")}
</td></tr>
<tr><td style="padding:6px 8px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#14111F" style="background:#14111F;border:1px solid #2A2540;border-radius:18px;"><tr><td style="padding:18px;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.7;color:#DCD8EA;">
<div style="font-size:11px;font-weight:700;letter-spacing:.1em;color:#8CF5E0;margin-bottom:6px;">HOW IT WORKS</div>
1. Click the button below and sign in with your usual Forever Careers email address and password. You'll be taken straight to the form.<br>
2. You have <b style="color:#FFFFFF;">one attempt</b> to complete it.<br>
3. When you submit, your answers are saved and your Forever Careers account and personal details are <b style="color:#FFFFFF;">permanently deleted</b>, so you won't be able to sign in again.<br>
4. The form is open until <b style="color:#FFFFFF;">${esc(until)}</b>. If it isn't completed by then, your account and details will be deleted automatically.
</td></tr></table></td></tr>
<tr><td style="padding:18px 8px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" bgcolor="#FFFFFF" style="background-color:#FFFFFF;border-radius:14px;"><a href="https://forevercalculatedcareers.com/feedback/" target="_blank" style="display:block;padding:15px 10px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:#120E22;text-decoration:none;">Share my feedback</a></td></tr></table></td></tr>
<tr><td style="padding:18px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:#DCD8EA;">
${P("If you can't sign in, or you'd simply rather reply to this email with a line or two, that's absolutely fine too.")}
${P(`Thank you again${n ? ", " + n : ""}, and I wish you every success with your search.`)}
</td></tr>
<tr><td style="padding:10px 8px 0;font-family:Arial,Helvetica,sans-serif;font-size:14.5px;line-height:1.6;color:#DCD8EA;">Kind regards,<br><b style="color:#FFFFFF;">Kenneth Nzegbulem</b><br>Founder, Forever Careers</td></tr>
<tr><td style="padding:18px 8px 20px;"><div style="border-top:1px solid #221C38;padding-top:14px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#7F789C;"><a href="https://forevercalculatedcareers.com" style="color:#8CF5E0;text-decoration:none;">forevercalculatedcareers.com</a></div></td></tr>
</table></td></tr></table></body></html>`;
  return { subject: kind === "ended" ? `${n ? n + ", could" : "Could"} you tell us how we did?` : `${n ? n + ", could" : "Could"} you tell us why you cancelled?`, html };
}

// Opens an exit feedback request (closing the account to everything except /feedback) and emails the member.
// Returns false if a request already exists for this member, so nobody is asked twice.
export async function startExitFlow(email, sendEmail, kind = "cancelled") {
  email = normEmail(email);
  const k = userKey(email);
  if (await requests().get(k, { type: "json" })) return false;
  const u = await st("users").get(k, { type: "json" });
  if (!u) return false;
  const now = Date.now();
  const r = await setRequest(email, { email, firstName: niceName(u.firstName), status: "pending", createdAt: new Date(now).toISOString(), expiresAt: new Date(now + REQUEST_DAYS * DAY).toISOString(), wipeAfter: true, auto: kind });
  await sendEmail({ to: email, ...exitEmail(u.firstName, r.expiresAt, kind) });
  return true;
}
