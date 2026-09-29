import { getStore } from "@netlify/blobs";
import { stripe, getBilling, setBilling, membershipFor, sendEmail, mail, enforcedFor } from "../lib/billing.mjs";
import { userKey, normEmail } from "../lib/common.mjs";

// Hourly: email anyone whose Stripe checkout expired without starting a trial. Once per person, ever.
async function nameFor(email) {
  try {
    const u = await getStore({ name: "users", consistency: "strong" }).get(userKey(email), { type: "json" });
    const n = (u && u.firstName) || "";
    return n === n.toUpperCase() ? n.toLowerCase().replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase()) : n;
  } catch { return ""; }
}

export default async () => {
  const since = Math.floor(Date.now() / 1000) - 48 * 3600;
  let list;
  try { list = await stripe("GET", `checkout/sessions?status=expired&limit=100&created[gte]=${since}`); }
  catch (e) { console.error("checkout-reminders list", e); return new Response("error", { status: 500 }); }
  let sent = 0;
  for (const o of list.data || []) {
    try {
      if (o.mode !== "subscription") continue;
      const email = normEmail((o.metadata && o.metadata.email) || (o.customer_details && o.customer_details.email) || o.customer_email || "");
      if (!email || !enforcedFor(email)) continue;
      const bill = (await getBilling(email)) || {};
      if (bill.checkoutReminderAt || bill.trialUsed) continue;
      const mem = await membershipFor(email).catch(() => null);
      if (mem && mem.active) continue;
      await sendEmail({ to: email, ...mail.checkoutReminder(await nameFor(email)) });
      await setBilling(email, { checkoutReminderAt: new Date().toISOString(), checkoutReminderFor: o.id });
      sent++;
    } catch (e) { console.error("checkout-reminders item", o && o.id, e); }
  }
  console.log("checkout-reminders sent", sent);
  return new Response(JSON.stringify({ sent }), { headers: { "content-type": "application/json" } });
};
export const config = { schedule: "@hourly" };
