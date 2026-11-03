import { json } from "../lib/common.mjs";
import { launchMsFrom } from "../lib/billing-core.mjs";

// Public: tells the page whether to show the free-trial wording.
export default async () => {
  const mode = "off"; // free for everyone (3 Nov 2026); ignores BILLING_MODE
  const l = launchMsFrom(process.env);
  return json({ mode, trialDays: 0, priceGbp: 0, launchAt: l ? new Date(l).toISOString() : null });
};
export const config = { path: "/api/billing-config" };
