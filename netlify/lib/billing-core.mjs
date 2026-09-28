// Pure billing rules (no I/O) so they can be unit-tested.
export const TRIAL_DAYS = 14;
export const DAY = 86400000;
export const PRICE_ID = "price_1UKaRHIzGjJjQQyt90AbANyc"; // £50 / month, Forever Careers - Monthly Job Access
const iso = (ms) => new Date(ms).toISOString();

// mode: "off" (everyone free, current behaviour) | "test" (only BILLING_TEST_EMAILS) | "on" (everyone)
export function billingEnforced(env, email) {
  const mode = String((env && env.BILLING_MODE) || "off").toLowerCase();
  if (mode === "on") return true;
  if (mode === "test") {
    const list = String((env && env.BILLING_TEST_EMAILS) || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
    return list.includes(String(email || "").toLowerCase());
  }
  return false;
}

export function launchMsFrom(env) {
  const v = env && env.BILLING_LAUNCH;
  const t = v ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
}

const isExisting = (user, launchMs) => {
  const created = user && user.createdAt ? Date.parse(user.createdAt) : NaN;
  return !!(launchMs && Number.isFinite(created) && created < launchMs);
};

export function decideMembership({ enforced, user, billing, now, launchMs }) {
  if (!enforced) return { active: true, free: true, plan: "Free account" };
  const st = billing && billing.status;
  if (st === "trialing" || st === "active" || st === "past_due") {
    const trialing = st === "trialing";
    const te = trialing && billing.trialEnd ? billing.trialEnd * 1000 : null;
    return {
      active: true, free: false, billing: true, status: st,
      plan: trialing ? "Free trial" : "Monthly plan",
      trialEndsAt: te ? iso(te) : null,
      daysLeft: te ? Math.max(0, Math.ceil((te - now) / DAY)) : null,
      renewsAt: billing.currentPeriodEnd ? iso(billing.currentPeriodEnd * 1000) : null,
      cancels: !!billing.cancelAtPeriodEnd, pastDue: st === "past_due", canManage: !!billing.customerId,
    };
  }
  if (isExisting(user, launchMs)) {
    if (now < launchMs) return { active: true, free: true, plan: "Free account", preLaunch: true };
    const deadline = launchMs + TRIAL_DAYS * DAY;
    if (now < deadline) {
      return { active: true, free: false, grace: true, needsCard: true, plan: "Free trial",
        trialEndsAt: iso(deadline), daysLeft: Math.max(0, Math.ceil((deadline - now) / DAY)) };
    }
  }
  return { active: false, free: false, needsCard: true, status: st || "none",
    trialAvailable: !(billing && billing.trialUsed) && !isExisting(user, launchMs),
    cancelled: st === "canceled" || st === "unpaid" || st === "incomplete_expired", plan: "No active plan" };
}

// How Checkout should treat the trial for this person.
export function decideTrial({ user, billing, now, launchMs }) {
  if (billing && billing.trialUsed) return { kind: "none" };
  if (isExisting(user, launchMs)) {
    const deadline = launchMs + TRIAL_DAYS * DAY;
    if (now >= deadline) return { kind: "none" };
    // Stripe needs trial_end at least 48h ahead; never shorten someone's remaining days
    const minEnd = now + 49 * 3600 * 1000;
    return { kind: "until", trialEnd: Math.floor(Math.max(deadline, minEnd) / 1000) };
  }
  return { kind: "days", days: TRIAL_DAYS };
}

// Stripe form-encoding (nested objects -> a[b][c]=v)
export function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object") formEncode(v, key, out); else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}
