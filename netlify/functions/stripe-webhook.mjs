import { getStore } from "@netlify/blobs";
import { getBilling, membershipFor, setBilling, linkCustomer, emailForCustomer, applySubscription, verifyStripeSignature, reactivationLink, sendEmail, mail, enforcedFor, fmtLong, isStudentSub } from "../lib/billing.mjs";
import { markCardSaved } from "../lib/student-flow.mjs";
import { STUDENT_PRICE_ID, STUDENT_PRICE_TEXT, getStudent, setStudent, reviewInbox } from "../lib/student.mjs";
import { userKey, normEmail } from "../lib/common.mjs";

const OK = (o = {}) => new Response(JSON.stringify({ received: true, ...o }), { status: 200, headers: { "content-type": "application/json" } });

async function nameFor(email) {
  try { const u = await getStore({ name: "users", consistency: "strong" }).get(userKey(email), { type: "json" }); const n = (u && u.firstName) || ""; return n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : n; } catch { return ""; }
}
async function handleEvent(ev) {
  const o = ev.data && ev.data.object;
  switch (ev.type) {
    case "checkout.session.completed": {
      if (o.mode === "setup" && o.metadata && o.metadata.purpose === "student") {
        const email = normEmail(o.metadata.email || "");
        if (email) await markCardSaved(email, typeof o.setup_intent === "string" ? o.setup_intent : o.setup_intent && o.setup_intent.id);
        return;
      }
      if (o.mode !== "subscription") return;
      const email = normEmail((o.metadata && o.metadata.email) || (o.customer_details && o.customer_details.email) || o.customer_email || "");
      if (email && o.customer) { await linkCustomer(o.customer, email); await setBilling(email, { customerId: o.customer, subscriptionId: o.subscription || null, trialUsed: true }); }
      return;
    }
    case "checkout.session.expired": {
      if (o.mode !== "subscription") return;
      const email = normEmail((o.metadata && o.metadata.email) || (o.customer_details && o.customer_details.email) || o.customer_email || "");
      if (!email || !enforcedFor(email)) return;
      const mem = await membershipFor(email).catch(() => null);
      if (mem && mem.active) return; // already started a trial or paying
      const bill = (await getBilling(email)) || {};
      if (bill.checkoutReminderAt || bill.trialUsed) return; // only ever once
      const name = await nameFor(email);
      await sendEmail({ to: email, ...mail.checkoutReminder(name) });
      await setBilling(email, { checkoutReminderAt: new Date().toISOString(), checkoutReminderFor: o.id });
      return;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const r = await applySubscription(o);
      if (r && isStudentSub(o) && ["trialing", "active"].includes(o.status)) {
        const st = await getStudent(r.email).catch(() => null);
        if (st && st.status === "approved_pending_card") await setStudent(r.email, { status: "approved", subscriptionId: o.id }, "trial started from emailed link");
        else if (!st || !["approved"].includes(st.status)) {
          const b = (await getBilling(r.email)) || {};
          if (b.unverifiedStudentAlertFor !== o.id) { await sendEmail({ to: reviewInbox(), ...mail.studentUnverified(r.email) }); await setBilling(r.email, { unverifiedStudentAlertFor: o.id }); }
        }
      }
      if (r && o.status === "trialing" && o.trial_end && enforcedFor(r.email) && r.saved.welcomedFor !== o.id && !(r.prev && r.prev.welcomedFor)) {
        const name = await nameFor(r.email);
        const w = isStudentSub(o) ? mail.studentWelcome : mail.welcome;
        await sendEmail({ to: r.email, ...w(name, fmtLong(o.trial_end * 1000)) });
        await setBilling(r.email, { welcomedFor: o.id, welcomedAt: new Date().toISOString() });
      }
      return;
    }
    case "customer.subscription.deleted": {
      const r = await applySubscription(o);
      if (!r || !enforcedFor(r.email)) return;
      if (r.saved.lastCancelEmailFor === o.id) return; // already emailed for this subscription
      const reason = o.cancellation_details && o.cancellation_details.reason;
      const student = isStudentSub(o);
      const link = await reactivationLink(r.email, student ? STUDENT_PRICE_ID : undefined);
      const name = await nameFor(r.email);
      const m = reason === "payment_failed" ? mail.paymentCancelled(name, link, student ? STUDENT_PRICE_TEXT : undefined) : mail.userCancelled(name, link);
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
