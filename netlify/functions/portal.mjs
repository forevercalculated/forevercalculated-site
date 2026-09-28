import { json, emailFromRequest } from "../lib/common.mjs";
import { SITE, stripe, getBilling } from "../lib/billing.mjs";

// Opens Stripe's customer portal (cancel, change card, invoices).
async function handle(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const email = emailFromRequest(req);
  if (!email) return json({ error: "Please sign in again." }, 401);
  const b = await getBilling(email);
  if (!b || !b.customerId) return json({ error: "No plan to manage yet." }, 404);
  const s = await stripe("POST", "billing_portal/sessions", { customer: b.customerId, return_url: `${SITE}/` });
  return json({ url: s.url });
}
export default async (req) => {
  try { return await handle(req); }
  catch (err) { console.error(err); return json({ error: "We couldn't open your billing page just now. Please try again." }, 500); }
};
export const config = { path: "/api/portal" };
