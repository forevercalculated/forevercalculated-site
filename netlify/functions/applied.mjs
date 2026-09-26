import { getStore } from "@netlify/blobs";
import { json, emailFromRequest, userKey } from "../lib/common.mjs";

// Remembers which roles a signed in user has marked as applied.
export default async (req) => {
  try {
    const email = emailFromRequest(req);
    if (!email) return json({ error: "Please sign in again." }, 401);
    const store = getStore({ name: "applied-v2", consistency: "strong" });
    const key = userKey(email);
    const rec = (await store.get(key, { type: "json" })) || { ids: [] };
    if (req.method === "GET") return json({ ids: rec.ids || [] });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const { jobId, applied } = await req.json().catch(() => ({}));
    const id = Number(jobId);
    if (!Number.isInteger(id) || id < 0) return json({ error: "Invalid job" }, 400);
    const ids = new Set(rec.ids || []);
    if (applied) ids.add(id); else ids.delete(id);
    await store.setJSON(key, { ids: [...ids] });
    return json({ ok: true, ids: [...ids] });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
};

export const config = { path: "/api/applied" };
