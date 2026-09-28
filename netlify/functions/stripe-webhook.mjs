import { getStore } from "@netlify/blobs";
import { setBilling, linkCustomer, emailForCustomer, applySubscription, verifyStripeSignature, reactivationLink, sendEmail, mail, enforcedFor, fmtLong } from "../lib/billing.mjs";
import { userKey, normEmail } from "../lib/common.mjs";

const OK = (o = {}) => new Response(JSON.stringify({ received: true, ...o }), { status: 200, headers: { "content-type": "application/json" } });

async function nameFor(email) {
  try { const u = await getStore({ name: "users", consistency: "strong" }).get(userKey(email), { type: "json" }); return (u && u.firstName) || ""; } catch { return ""; }
}
async function handleEvent(ev) {
  const o = ev.data && ev.data.object;
  switch (ev.type) {
    case "checkout.session.completed": {
      if (o.mode !== "subscription") return;
      const email = normEmail((o.metadata && o.metadata.email) || (o.customer_details && o.customer_details.email) || o.customer_email || "");
      if (email && o.customer) { await linkCustomer(o.customer, email); await setBilling(email, { customerId: o.customer, subscriptionId: o.subscription || null, trialUsed: true }); }
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const r = await applySubscription(o);
      if (r && o.status === "trialing" && o.trial_end && enforcedFor(r.email) && r.saved.welcomedFor !== o.id && !(r.prev && r.prev.welcomedFor)) {
        const name = await nameFor(r.email);
        await sendEmail({ to: r.email, ...mail.welcome(name, fmtLong(o.trial_end * 1000)) });
        await setBilling(r.email, { welcomedFor: o.id, welcomedAt: new Date().toISOString() });
      }
      return;
    }
    case "customer.subscription.deleted": {
      const r = await applySubscription(o);
      if (!r || !enforcedFor(r.email)) return;
      if (r.saved.lastCancelEmailFor === o.id) return; // already emailed for this subscription
      const reason = o.cancellation_details && o.cancellation_details.reason;
      const link = await reactivationLink(r.email);
      const name = await nameFor(r.email);
      const m = reason === "payment_failed" ? mail.paymentCancelled(name, link) : mail.userCancelled(name, link);
      await sendEmail({ to: r.email, ...m });
      await setBilling(r.email, { lastCancelEmailFor: o.id, cancelReason: reason || "cancelled", cancelledAt: new Date().toISOString() });
      return;
    }
    case "invoice.payment_failed": {
      if (o.customer) { const email = await emailForCustomer(o.customer); if (email) await setBilling(email, { lastPaymentFailedAt: new Date().toISOString() }); }
      return;
    }
    case "invoice.paid": {
      if (o.customer) { const email = await emailForCustomer(o.customer); if (email) await setBilling(email, { lastPaidAt: new Date().toISOString() }); }
      return;
    }
    default: return;
  }
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"), process.env.STRIPE_WEBHOOK_SECRET)) return new Response("Bad signature", { status: 400 });
  let ev; try { ev = JSON.parse(raw); } catch { return new Response("Bad payload", { status: 400 }); }
  try { await handleEvent(ev); return OK(); }
  catch (err) { console.error("webhook", ev.type, err); return new Response("Handler error", { status: 500 }); } // Stripe retries
};
export const config = { path: "/api/stripe-webhook" };
