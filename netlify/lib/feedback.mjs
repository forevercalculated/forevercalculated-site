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
  { id: "q8", text: "How did you feel about the price of £50 a month?", options: ["Good value", "About right", "A little too high", "Much too high", "I didn't reach the paid stage"] },
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
