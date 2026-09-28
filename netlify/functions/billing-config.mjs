import { json } from "../lib/common.mjs";
import { launchMsFrom } from "../lib/billing-core.mjs";

// Public: tells the page whether to show the 14-day-trial wording.
export default async () => {
  const mode = String(process.env.BILLING_MODE || "off").toLowerCase();
  const l = launchMsFrom(process.env);
  return json({ mode: /^(test|on)$/.test(mode) ? mode : "off", trialDays: 14, priceGbp: 50, launchAt: l ? new Date(l).toISOString() : null });
};
export const config = { path: "/api/billing-config" };
