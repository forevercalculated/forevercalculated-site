import { getStore } from "@netlify/blobs";
import { json, emailFromRequest, userKey } from "../lib/common.mjs";
import jobs from "../lib/jobs-data.mjs";
const BY_ID = new Map(jobs.map((j) => [j.id, j]));

// Records every Apply tap by a signed in user, so they (and the founder) can see their history.
export default async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const email = emailFromRequest(req);
    if (!email) return json({ error: "Please sign in again." }, 401);
    const { jobId } = await req.json().catch(() => ({}));
    const id = Number(jobId);
    const job = Number.isInteger(id) ? BY_ID.get(id) : null;
    if (!job) return json({ error: "Unknown role" }, 400);
    const store = getStore({ name: "apply-log", consistency: "strong" });
    const key = userKey(email);
    const rec = (await store.get(key, { type: "json" })) || { email, events: [] };
    rec.email = email;
    rec.events.push({ id, title: job.title, company: job.company, location: job.location, country: job.country, at: new Date().toISOString() });
    if (rec.events.length > 500) rec.events = rec.events.slice(-500);
    await store.setJSON(key, rec);
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong." }, 500);
  }
};

export const config = { path: "/api/track-apply" };
