import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";
import { userKey, normEmail } from "./common.mjs";
import { PRICE_ID, TRIAL_DAYS, DAY, billingEnforced, launchMsFrom, decideMembership, decideTrial, formEncode } from "./billing-core.mjs";
import { getStudent, studentGate, STUDENT_PRICE_ID } from "./student.mjs";

export const SITE = "https://forevercalculatedcareers.com";
const store = () => getStore({ name: "billing", consistency: "strong" });
const users = () => getStore({ name: "users", consistency: "strong" });

export const enforcedFor = (email) => billingEnforced(process.env, email);
export const launchMs = () => launchMsFrom(process.env);
export const getBilling = async (email) => (await store().get(userKey(normEmail(email)), { type: "json" })) || null;
export async function setBilling(email, patch) {
  const k = userKey(normEmail(email));
  const prev = (await store().get(k, { type: "json" })) || {};
  const next = { ...prev, ...patch, email: normEmail(email), updatedAt: new Date().toISOString() };
  await store().setJSON(k, next);
  return next;
}
export const linkCustomer = (customerId, email) => store().setJSON("cus:" + customerId, { email: normEmail(email) });
export async function emailForCustomer(customerId) {
  const r = await store().get("cus:" + customerId, { type: "json" });
  if (r && r.email) return r.email;
  try {
    const c = await stripe("GET", "customers/" + customerId);
    if (c && c.email) { await linkCustomer(customerId, c.email); return normEmail(c.email); }
  } catch (e) { console.error("emailForCustomer", e); }
  return null;
}

const periodEnd = (sub) => sub.current_period_end || (sub.items && sub.items.data && sub.items.data[0] && sub.items.data[0].current_period_end) || null;

export async function applySubscription(sub, hintEmail) {
  const email = normEmail((sub.metadata && sub.metadata.email) || hintEmail || (await emailForCustomer(sub.customer)) || "");
  if (!email) { console.error("billing: no email for subscription", sub.id); return null; }
  await linkCustomer(sub.customer, email);
  const patch = { customerId: sub.customer, subscriptionId: sub.id, status: sub.status, trialEnd: sub.trial_end || null, currentPeriodEnd: periodEnd(sub), cancelAtPeriodEnd: !!sub.cancel_at_period_end };
  if (sub.trial_end || sub.status === "trialing" || sub.status === "active") patch.trialUsed = true;
  const prev = await getBilling(email);
  const saved = await setBilling(email, patch);
  return { email, prev, saved };
}

// Safety net: if a webhook was missed or is late, ask Stripe directly (at most once a minute per person).
export async function reconcile(email, billing) {
  email = normEmail(email);
  try {
    const now = Date.now();
    if (!billing || !billing.customerId) {
      // Checkout creates the Stripe customer only when it completes, so look them up by email.
      const last0 = billing && billing.reconciledAt ? Date.parse(billing.reconciledAt) : 0;
      if (now - last0 < 60000) return billing;
      const cs = await stripe("GET", `customers?email=${encodeURIComponent(email)}&limit=5`);
      const cust = (cs.data || []).sort((a, b) => b.created - a.created)[0];
      if (!cust) { await setBilling(email, { reconciledAt: new Date().toISOString() }); return await getBilling(email); }
      await linkCustomer(cust.id, email);
      billing = await setBilling(email, { customerId: cust.id, reconciledAt: new Date(0).toISOString() });
    }
    const st = billing.status;
    const live = st === "trialing" || st === "active" || st === "past_due";
    const overdue = (billing.trialEnd && billing.trialEnd * 1000 < now) || (billing.currentPeriodEnd && billing.currentPeriodEnd * 1000 < now);
    if (live && !overdue) return billing;
    const last = billing.reconciledAt ? Date.parse(billing.reconciledAt) : 0;
    if (now - last < 60000) return billing;
    const list = await stripe("GET", `subscriptions?customer=${encodeURIComponent(billing.customerId)}&status=all&limit=5`);
    const subs = (list.data || []).sort((a, b) => b.created - a.created);
    const pick = subs.find((x) => ["trialing", "active", "past_due"].includes(x.status)) || subs[0];
    if (pick) await applySubscription(pick, email);
    await setBilling(email, { reconciledAt: new Date().toISOString() });
    return await getBilling(email);
  } catch (e) { console.error("reconcile", e); return billing; }
}

export async function membershipFor(email) {
  const e = normEmail(email);
  if (!enforcedFor(e)) return decideMembership({ enforced: false });
  const [user, b0, student] = await Promise.all([users().get(userKey(e), { type: "json" }), getBilling(e), getStudent(e).catch(() => null)]);
  const billing = await reconcile(e, b0);
  return studentGate(decideMembership({ enforced: true, user, billing, now: Date.now(), launchMs: launchMs() }), student, billing);
}
export async function trialFor(email) {
  const e = normEmail(email);
  const [user, billing] = await Promise.all([users().get(userKey(e), { type: "json" }), getBilling(e)]);
  return { user, billing, trial: decideTrial({ user, billing, now: Date.now(), launchMs: launchMs() }) };
}

export async function stripe(method, path, body) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const init = { method, headers: { authorization: `Bearer ${key}` } };
  if (body) { init.headers["content-type"] = "application/x-www-form-urlencoded"; init.body = formEncode(body).join("&"); }
  const res = await fetch(`https://api.stripe.com/v1/${path}`, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${(data.error && data.error.message) || "error"}`);
  return data;
}

export function verifyStripeSignature(raw, header, secret) {
  if (!header || !secret) return false;
  const parts = header.split(",").map((p) => p.split("="));
  const t = (parts.find((p) => p[0] === "t") || [])[1];
  const sigs = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (!t || !sigs.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const exp = crypto.createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex");
  return sigs.some((s) => s.length === exp.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp)));
}

// Is this Stripe subscription on the student price?
export const isStudentSub = (sub) => !!(sub && sub.items && (sub.items.data || []).some((i) => i.price && i.price.id === STUDENT_PRICE_ID));

// Permanent "pay to reactivate" link (Stripe Payment Link), created once per price and cached.
export async function reactivationLink(email, price = PRICE_ID) {
  const s = store();
  const cacheKey = price === PRICE_ID ? "_paylink" : "_paylink_" + price;
  let pl = await s.get(cacheKey, { type: "json" });
  if (!pl || !pl.url) {
    const r = await stripe("POST", "payment_links", {
      line_items: { 0: { price, quantity: 1 } },
      after_completion: { type: "redirect", redirect: { url: `${SITE}/?paid=1` } },
      billing_address_collection: "auto",
    });
    pl = { id: r.id, url: r.url };
    await s.setJSON(cacheKey, pl);
  }
  const q = new URLSearchParams({ client_reference_id: userKey(normEmail(email)), prefilled_email: normEmail(email) });
  return `${pl.url}?${q.toString()}`;
}

// ---- email: Resend if configured, otherwise queued in an outbox so nothing is lost ----
export async function sendEmail({ to, subject, html }) {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM || "Forever Careers <hello@forevercalculatedcareers.com>", to: [to], subject, html }),
    });
    if (res.ok) return { sent: true };
    console.error("resend", res.status, await res.text());
  }
  const ob = getStore({ name: "outbox", consistency: "strong" });
  await ob.setJSON(`${Date.now()}-${crypto.randomBytes(3).toString("hex")}`, { to, subject, html, createdAt: new Date().toISOString(), sent: false });
  return { sent: false, queued: true };
}

const wrap = (inner) => `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0b0f13;line-height:1.55">${inner}<p style="color:#6b7480;font-size:13px;margin-top:28px">Forever Careers &middot; <a href="${SITE}" style="color:#6b7480">forevercalculatedcareers.com</a></p></div>`;
const btn = (href, label) => `<p style="margin:22px 0"><a href="${href}" style="background:#0b0f13;color:#fff;text-decoration:none;padding:13px 22px;border-radius:8px;font-weight:600;display:inline-block">${label}</a></p>`;
const first = (n) => (n ? `Hi ${n},` : "Hi,");

const li = (t) => `<tr><td style="padding:0 10px 10px 0;vertical-align:top;color:#16A672;font-weight:700">&#10003;</td><td style="padding:0 0 10px">${t}</td></tr>`;
export const mail = {
  welcome: (name, dateText) => ({ subject: `Welcome to Forever Careers${name ? ", " + name : ""}. Your free trial has started`, html: wrap(`<p>${first(name)}</p>
<p>Welcome to Forever Careers. We're so glad you're here, and thank you for trusting us with something as important as your next job.</p>
<p>Looking for work can feel lonely. You don't have to do it on your own any more. You've just joined a community of people across 19 countries who are moving forward together, and from today we're in your corner.</p>
<p style="margin:22px 0 10px"><b>Here's what your 14-day free trial includes</b></p>
<table style="border-collapse:collapse;font-size:15px;line-height:1.5">
${li("<b>Full access to our job board.</b> Thousands of live remote, hybrid and on-site roles across 19 countries, with direct links to apply.")}
${li("<b>Jobs matched to your CV, twice a day.</b> Every morning and evening we send you the roles that best fit your skills and experience, straight to your inbox.")}
${li("<b>Roles you can trust.</b> We check the board every day and remove closed and duplicate listings, so your time goes on real opportunities.")}
</table>
<p style="margin-top:18px">Your free trial runs until <b>${dateText}</b>. After that it's <b>£50 a month</b>, and you can cancel at any time from <b>Manage plan</b> on the site. No awkward phone calls, no fuss. We'll send you a reminder before your trial ends.</p>
${btn(SITE, "Start exploring your roles")}
<p>If anything doesn't feel right, or you'd just like to talk something through, email us at <a href="mailto:hello@forevercalculatedcareers.com">hello@forevercalculatedcareers.com</a>. We read every message and we'll get back to you.</p>
<p>Here's to your next role.</p>
<p>Kenneth and the Forever Careers team</p>`) }),
  paymentCancelled: (name, link, amount = "£50") => ({ subject: "Your Forever Careers account has been cancelled", html: wrap(`<p>${first(name)}</p><p>We couldn't take your ${amount} monthly payment, so your Forever Careers account has been cancelled and your job emails have stopped.</p><p>To restart, make your payment with the secure link below. Your account reactivates automatically with the same login details.</p>${btn(link, `Pay ${amount} and reactivate`)}<p>If you think this is a mistake, just reply to this email.</p>`) }),
  userCancelled: (name, link) => ({ subject: "Your Forever Careers plan has been cancelled", html: wrap(`<p>${first(name)}</p><p>Your Forever Careers plan is cancelled, so you won't be charged again.</p><p>If you change your mind, you can restart any time and your login stays the same.</p>${btn(link, "Restart my plan")}`) }),
  graceReminder: (name, daysLeft, dateText) => ({ subject: daysLeft <= 1 ? "Last day of your Forever Careers free trial" : `${daysLeft} days left of your Forever Careers free trial`, html: wrap(`<p>${first(name)}</p><p>Your free trial ends on <b>${dateText}</b>. To keep receiving your CV-matched jobs and full access, add your card now. Your card is only charged when the trial ends, then £50 a month. Cancel any time.</p>${btn(`${SITE}/?subscribe=1`, "Add card and keep my access")}`) }),
  checkoutReminder: (name) => ({ subject: "Your job matches are ready to switch on", html: wrap(`<p>${first(name)}</p><p>Thanks for signing up to Forever Careers. You're one step away from getting jobs matched to your CV sent to your inbox every morning and evening.</p><p>Your <b>14 day free trial</b> hasn't started yet. Your card isn't charged today, and you can cancel any time before day 14 and pay nothing.</p>${btn(`${SITE}/?subscribe=1`, "Start my free trial")}<p>If something went wrong at checkout or you have a question, just reply to this email and Kenneth will help.</p>`) }),
  studentReceived: (name) => ({ subject: "We're reviewing your student ID", html: wrap(`<p>${first(name)}</p>
<p>Thank you for applying for the Forever Careers student plan. Your student ID is now being reviewed.</p>
<p>You'll get access to the website and start receiving your job alerts <b>within 24 hours</b>, as soon as your ID is approved. We'll email you the moment it is.</p>
<p>Your <b>14-day free trial starts on the day you're approved</b>, not today. Your card has been saved securely by Stripe and <b>is not charged during the review</b>. After your trial it's ${"£19.99"} a month, and you can cancel any time.</p>
<p>Any questions, just reply to this email or write to <a href="mailto:hello@forevercalculatedcareers.com">hello@forevercalculatedcareers.com</a>.</p>
<p>Kenneth and the Forever Careers team</p>`) }),
  studentWelcome: (name, dateText) => ({ subject: `You're approved${name ? ", " + name : ""}. Your Forever Careers student trial has started`, html: wrap(`<p>${first(name)}</p>
<p>Great news: your student ID has been approved and your <b>14-day free trial has started today</b>. Every role on the site is now unlocked, and your CV-matched job alerts will start arriving by email every morning and evening.</p>
<table style="border-collapse:collapse;font-size:15px;line-height:1.5">
${li("<b>Full access to our job board.</b> Thousands of live remote, hybrid and on-site roles across 19 countries.")}
${li("<b>Jobs matched to your CV, twice a day.</b> Straight to your inbox.")}
${li("<b>Student price.</b> £19.99 a month after your trial, instead of £50.")}
</table>
<p style="margin-top:18px">Your free trial runs until <b>${dateText}</b>. After that it's <b>£19.99 a month</b>, and you can cancel any time from <b>Manage plan</b> on the site. We'll remind you before your trial ends.</p>
${btn(SITE, "Start exploring your roles")}
<p>Any questions, email <a href="mailto:hello@forevercalculatedcareers.com">hello@forevercalculatedcareers.com</a>.</p>
<p>Kenneth and the Forever Careers team</p>`) }),
  studentRejected: (name, reason) => ({ subject: "About your Forever Careers student application", html: wrap(`<p>${first(name)}</p>
<p>Thank you for applying for the Forever Careers student plan. Unfortunately we weren't able to approve your student ID${reason ? ":" : "."}</p>
${reason ? `<p style="background:#f4f6f8;border-radius:8px;padding:12px 14px">${String(reason).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</p>` : ""}
<p>Your card has <b>not been charged</b> and we've removed it from your account. We've also deleted the ID you uploaded.</p>
<p>You're welcome to apply again with a clear photo of a current student ID, or start the standard 14-day free trial (then £50 a month) from the site.</p>
${btn(SITE, "Go to Forever Careers")}
<p>If you think this is a mistake, just reply to this email.</p>`) }),
  studentAdmin: (s, link) => ({ subject: `Student ID to review: ${s.firstName || ""} ${s.lastName || ""} (${s.institution || "student"})`.replace(/\s+/g, " "), html: wrap(`<p>A new student application is waiting for your review.</p>
<p><b>${s.firstName || ""} ${s.lastName || ""}</b><br>${s.email}<br>${s.institution || ""}, ${s.course || ""} (graduating ${s.gradYear || "?"})</p>
<p>Their card is saved and they have no access until you approve. Promised turnaround: 24 hours.</p>
${btn(link, "Review student ID")}`) }),
  accessPaused: (name) => ({ subject: "Your Forever Careers free trial has ended", html: wrap(`<p>${first(name)}</p><p>Your free trial has ended, so your job emails are paused. Add your card to switch everything back on with the same login.</p>${btn(`${SITE}/?subscribe=1`, "Restart for £50 a month")}`) }),
};
export const fmtLong = (ms) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
export { TRIAL_DAYS, DAY, PRICE_ID };
