import { getStore } from "@netlify/blobs";
import { json, emailFromRequest, userKey } from "../lib/common.mjs";

// Saves a CV from the free scan, only when the signed in user ticks the consent box.
export default async (req) => {
  try {
    const email = emailFromRequest(req);
    if (!email) return json({ error: "Please sign in again." }, 401);
    const store = getStore({ name: "cvs", consistency: "strong" });
    const key = userKey(email);
    if (req.method === "DELETE") { await store.delete(key); return json({ ok: true, deleted: true }); }
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const { text, score, consent } = await req.json().catch(() => ({}));
    if (consent !== true) return json({ error: "Consent is required to save your CV." }, 400);
    const cv = String(text || "").trim().slice(0, 30000);
    if (cv.length < 30) return json({ error: "CV text is too short." }, 400);
    await store.setJSON(key, { email, text: cv, score: String(score || "").slice(0, 10), savedAt: new Date().toISOString(), consent: true });
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong." }, 500);
  }
};

export const config = { path: "/api/cv-save" };
