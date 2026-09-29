import { getStore } from "@netlify/blobs";
import { json, emailFromRequest, userKey } from "../lib/common.mjs";
import { SITE, stripe, enforcedFor, trialFor, setBilling, linkCustomer, membershipFor, PRICE_ID, TRIAL_DAYS } from "../lib/billing.mjs";

async function handle(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const email = emailFromRequest(req);
  if (!email) return json({ error: "Please sign in again." }, 401);
  if (!enforcedFor(email)) return json({ error: "Billing is not switched on for this account yet." }, 403);

  const m = await membershipFor(email);
  if (m.billing) return json({ error: "You already have an active plan.", alreadyActive: true }, 409);

  const { billing, trial } = await trialFor(email);
  const sub = { metadata: { email, uk: userKey(email) }, trial_settings: { end_behavior: { missing_payment_method: "cancel" } } };
  let msg;
  if (trial.kind === "days") { sub.trial_period_days = TRIAL_DAYS; msg = `Start your ${TRIAL_DAYS}-day free trial. Your card is not charged today. After the trial you'll be charged £50 per month until you cancel. You can cancel any time from your account.`; }
  else if (trial.kind === "until") { sub.trial_end = trial.trialEnd; const d = new Date(trial.trialEnd * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }); msg = `Your free trial continues until ${d}. Your card is not charged today. From ${d} you'll be charged £50 per month until you cancel. You can cancel any time from your account.`; }
  else msg = "You'll be charged £50 today and then £50 per month until you cancel. You can cancel any time from your account.";

  const body = {
    mode: "subscription",
    line_items: { 0: { price: PRICE_ID, quantity: 1 } },
    payment_method_collection: "always",
    success_url: `${SITE}/?paid=1`,
    cancel_url: `${SITE}/?checkout=cancelled`,
    client_reference_id: userKey(email),
    metadata: { email, uk: userKey(email) },
    subscription_data: sub,
    billing_address_collection: "auto",
    locale: "en-GB",
    custom_text: { submit: { message: msg } },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };
  if (billing && billing.customerId) body.customer = billing.customerId; else body.customer_email = email;
  const session = await stripe("POST", "checkout/sessions", body);
  if (session.customer) { await linkCustomer(session.customer, email); await setBilling(email, { customerId: session.customer }); }
  return json({ url: session.url });
}

export default async (req) => {
  try { return await handle(req); }
  catch (err) { console.error(err); return json({ error: "We couldn't start checkout just now. Please try again.", ...(process.env.BILLING_MODE === "test" ? { detail: String(err && err.message).slice(0, 300) } : {}) }, 500); }
};
export const config = { path: "/api/checkout" };
