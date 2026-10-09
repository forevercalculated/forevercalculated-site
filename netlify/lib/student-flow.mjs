// Student plan actions that touch Stripe and email (kept apart from student.mjs to avoid import loops).
import crypto from "node:crypto";
import { normEmail } from "./common.mjs";
import { SITE, stripe, getBilling, applySubscription, sendEmail, mail } from "./billing.mjs";
import { getStudent, getStudentByKey, setStudentByKey, studentKey, deleteIdFile, maskId, reviewInbox, STUDENT_PRICE_ID, STUDENT_TRIAL_DAYS, studentTrialUrl } from "./student.mjs";

export const isPermissionError = (e) => /Stripe 403/.test(String((e && e.message) || e));

// Used when the Stripe key can't save cards: go straight to review, card comes after approval.
export async function submitWithoutCard(email, patch) {
  email = normEmail(email);
  const k = studentKey(email);
  const next = await setStudentByKey(k, { ...patch, status: "pending_review", cardMode: "after_approval", paymentMethodId: null, setupSessionId: null }, "applied (card after approval)");
  try { await sendEmail({ to: email, ...mail.studentReceived(niceName(next.firstName), true) }); } catch (e) { console.error("studentReceived", e); }
  try { await sendEmail({ to: reviewInbox(), ...mail.studentAdmin(next, reviewLink()) }); } catch (e) { console.error("studentAdmin", e); }
  return next;
}

const niceName = (n) => { n = String(n || ""); return n && n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : n; };
const reviewLink = () => `${SITE}/admin/students.html`;

// Card saved on Stripe (setup mode finished): move to review and send both emails. Safe to call twice.
export async function markCardSaved(email, setupIntentId) {
  email = normEmail(email);
  const k = studentKey(email);
  const rec = await getStudentByKey(k);
  if (!rec || rec.status !== "awaiting_card") return rec;
  let pm = null;
  if (setupIntentId) {
    const si = await stripe("GET", "setup_intents/" + encodeURIComponent(setupIntentId));
    if (si.status !== "succeeded") return rec;
    pm = typeof si.payment_method === "string" ? si.payment_method : si.payment_method && si.payment_method.id;
  }
  if (!pm) return rec;
  const next = await setStudentByKey(k, { status: "pending_review", paymentMethodId: pm, cardSavedAt: new Date().toISOString() }, "card saved, waiting for review");
  try { await sendEmail({ to: email, ...mail.studentReceived(niceName(rec.firstName)) }); } catch (e) { console.error("studentReceived", e); }
  try { await sendEmail({ to: reviewInbox(), ...mail.studentAdmin(rec, reviewLink()) }); } catch (e) { console.error("studentAdmin", e); }
  return next;
}

// Safety net if the webhook is late: ask Stripe whether the card page was completed (at most every 30s).
export async function reconcileStudent(email, rec) {
  try {
    if (!rec || rec.status !== "awaiting_card" || !rec.setupSessionId) return rec;
    const last = rec.checkedAt ? Date.parse(rec.checkedAt) : 0;
    if (Date.now() - last < 30000) return rec;
    await setStudentByKey(studentKey(email), { checkedAt: new Date().toISOString() });
    const s = await stripe("GET", "checkout/sessions/" + encodeURIComponent(rec.setupSessionId));
    if (s.status === "complete" && s.setup_intent) return (await markCardSaved(email, typeof s.setup_intent === "string" ? s.setup_intent : s.setup_intent.id)) || rec;
    return await getStudent(email);
  } catch (e) { console.error("reconcileStudent", e); return rec; }
}

async function stripeIdem(method, path, body, idemKey) {
  // same as stripe() but with an idempotency key, so a double click can never create two subscriptions
  const { formEncode } = await import("./billing-core.mjs");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": idemKey },
    body: formEncode(body).join("&"),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${(data.error && data.error.message) || "error"}`);
  return data;
}

export async function approveStudent(k, { trial = true } = {}) {
  const rec = await getStudentByKey(k);
  if (!rec) return { error: "Application not found.", status: 404 };
  if (rec.status === "approved") return { ok: true, already: true, record: rec };
  if (rec.status === "approved_pending_card") return { ok: true, already: true, record: rec };
  if (rec.status !== "pending_review") return { error: "This application isn't waiting for review (status: " + rec.status + ").", status: 409 };
  const email = normEmail(rec.email);
  const billing = (await getBilling(email)) || {};
  if (["trialing", "active", "past_due"].includes(billing.status)) return { error: "This person already has an active plan.", status: 409 };
  if (!rec.paymentMethodId || !rec.customerId) return approveWithLink(k, rec, email);
  try { return await approveWithCard(k, rec, email, trial); }
  catch (e) { if (isPermissionError(e)) return approveWithLink(k, rec, email); throw e; }
}

// No saved card (or the key can't create subscriptions): email the student their personal trial link.
async function approveWithLink(k, rec, email) {
  const url = studentTrialUrl(email);
  await deleteIdFile(k);
  const next = await setStudentByKey(k, { status: "approved_pending_card", decidedAt: new Date().toISOString(), linkSentAt: new Date().toISOString(), studentId: maskId(rec.studentId), hasFile: false }, "approved, trial link emailed");
  await sendEmail({ to: email, ...mail.studentApprovedLink(niceName(rec.firstName), url) });
  return { ok: true, record: next, linkSent: true };
}

async function approveWithCard(k, rec, email, trial) {

  // make the saved card the customer's default for renewals
  await stripe("POST", "customers/" + encodeURIComponent(rec.customerId), { invoice_settings: { default_payment_method: rec.paymentMethodId } });
  const sub = await stripeIdem("POST", "subscriptions", {
    customer: rec.customerId,
    items: { 0: { price: STUDENT_PRICE_ID, quantity: 1 } },
    default_payment_method: rec.paymentMethodId,
    ...(trial ? { trial_period_days: STUDENT_TRIAL_DAYS, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } } : {}),
    payment_behavior: "allow_incomplete",
    metadata: { email, uk: k, plan: "student" },
  }, "student-approve-" + k + "-" + crypto.createHash("sha256").update(String(rec.submittedAt)).digest("hex").slice(0, 16));
  await applySubscription(sub, email); // access + job alerts switch on straight away; the webhook sends the welcome email

  await deleteIdFile(k);
  const next = await setStudentByKey(k, { status: "approved", subscriptionId: sub.id, decidedAt: new Date().toISOString(), studentId: maskId(rec.studentId), hasFile: false, trialGiven: !!trial }, "approved" + (trial ? " with 3 free months" : " without free months"));
  return { ok: true, record: next, subscription: { id: sub.id, status: sub.status, trial_end: sub.trial_end || null } };
}

export async function rejectStudent(k, reason) {
  const rec = await getStudentByKey(k);
  if (!rec) return { error: "Application not found.", status: 404 };
  if (rec.status === "rejected") return { ok: true, already: true, record: rec };
  if (rec.status === "approved") return { error: "This student is already approved. Cancel their plan in Stripe instead.", status: 409 };
  if (rec.paymentMethodId) { try { await stripe("POST", "payment_methods/" + encodeURIComponent(rec.paymentMethodId) + "/detach"); } catch (e) { console.error("detach", e); } }
  await deleteIdFile(k);
  const why = String(reason || "").trim().slice(0, 500);
  const next = await setStudentByKey(k, { status: "rejected", reason: why || null, paymentMethodId: null, decidedAt: new Date().toISOString(), studentId: maskId(rec.studentId), hasFile: false }, "rejected" + (why ? ": " + why : ""));
  try { await sendEmail({ to: rec.email, ...mail.studentRejected(niceName(rec.firstName), why) }); } catch (e) { console.error("studentRejected", e); }
  return { ok: true, record: next };
}

// Student changes their mind (or 30 days pass): remove ID and card, give normal access options back.
export async function closeStudent(k, status, note) {
  const rec = await getStudentByKey(k);
  if (!rec || !["awaiting_card", "pending_review"].includes(rec.status)) return rec;
  if (rec.paymentMethodId) { try { await stripe("POST", "payment_methods/" + encodeURIComponent(rec.paymentMethodId) + "/detach"); } catch (e) { console.error("detach", e); } }
  await deleteIdFile(k);
  return setStudentByKey(k, { status, paymentMethodId: null, hasFile: false, studentId: maskId(rec.studentId), decidedAt: new Date().toISOString() }, note);
}
