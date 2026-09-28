import { getStore } from "@netlify/blobs";
import { normEmail, userKey } from "../lib/common.mjs";
import { enforcedFor, launchMs, getBilling, setBilling, sendEmail, mail, fmtLong, DAY, TRIAL_DAYS } from "../lib/billing.mjs";

// Runs daily at 08:00 UTC. Reminders for existing members who have not added a card yet.
const MAX_PER_RUN = 80; // stays inside a 100/day email plan

export default async () => {
  const launch = launchMs();
  if (!launch || Date.now() < launch) return new Response("not launched");
  const now = Date.now(), deadline = launch + TRIAL_DAYS * DAY;
  const daysLeft = Math.ceil((deadline - now) / DAY);
  const us = getStore({ name: "users", consistency: "strong" });
  const list = await us.list();
  let sent = 0, checked = 0;
  for (const b of list.blobs || []) {
    if (sent >= MAX_PER_RUN) break;
    const u = await us.get(b.key, { type: "json" });
    if (!u || !u.email) continue;
    const email = normEmail(u.email);
    if (!enforcedFor(email)) continue;
    if (!(Date.parse(u.createdAt) < launch)) continue; // only existing members get the countdown
    checked++;
    const bill = (await getBilling(email)) || {};
    if (["trialing", "active", "past_due"].includes(bill.status)) continue;
    const done = bill.reminders || {};
    let key = null, m = null;
    if (now < deadline) {
      if (daysLeft <= 1 && !done.d1) { key = "d1"; m = mail.graceReminder(u.firstName, 1, fmtLong(deadline)); }
      else if (daysLeft <= 3 && !done.d3 && !done.d1) { key = "d3"; m = mail.graceReminder(u.firstName, Math.max(daysLeft, 1), fmtLong(deadline)); }
      else if (daysLeft <= 7 && !done.d7 && !done.d3 && !done.d1) { key = "d7"; m = mail.graceReminder(u.firstName, daysLeft, fmtLong(deadline)); }
    } else if (!done.paused) { key = "paused"; m = mail.accessPaused(u.firstName); }
    if (!key) continue;
    await sendEmail({ to: email, ...m });
    await setBilling(email, { reminders: { ...done, [key]: new Date().toISOString() } });
    sent++;
  }
  return new Response(JSON.stringify({ checked, sent }), { status: 200 });
};
export const config = { schedule: "0 8 * * *" };
