import { json, emailFromRequest, getMembership } from "../lib/common.mjs";
import jobs from "../lib/jobs-data.mjs";

async function handle(req) {
  const email = emailFromRequest(req);
  if (!email) return json({ error: "Please sign in again." }, 401);
  let membership;
  try { membership = await getMembership(email); }
  catch (err) { console.error(err); return json({ error: "We couldn't check your plan just now." }, 503); }
  if (!membership.active) return json({ error: "No active plan." }, 402);
  const urls = {};
  jobs.forEach((j, i) => { urls[i] = j.url; });
  return json({ urls });
}

export default async (req) => {
  try { return await handle(req); }
  catch (err) { console.error(err); return json({ error: "Something went wrong. Please try again." }, 500); }
};

export const config = { path: "/api/jobs" };
