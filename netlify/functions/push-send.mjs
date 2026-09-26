import { getStore } from "@netlify/blobs";
import webpush from "web-push";
import { json } from "../lib/common.mjs";

export default async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const admin = process.env.PUSH_ADMIN_KEY;
    if (!admin || req.headers.get("x-admin-key") !== admin) return json({ error: "Unauthorised" }, 401);
    const { title, body, url } = await req.json().catch(() => ({}));
    if (!title) return json({ error: "title required" }, 400);
    webpush.setVapidDetails("mailto:forevercalculated@gmail.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    const store = getStore({ name: "push-subs", consistency: "strong" });
    const { blobs } = await store.list();
    let sent = 0, removed = 0, failed = 0;
    const payload = JSON.stringify({ title, body: body || "", url: url || "/" });
    await Promise.all(blobs.map(async ({ key }) => {
      const rec = await store.get(key, { type: "json" });
      if (!rec || !rec.sub) return;
      try { await webpush.sendNotification(rec.sub, payload, { TTL: 3600 }); sent++; }
      catch (e) {
        if (e && (e.statusCode === 404 || e.statusCode === 410)) { await store.delete(key); removed++; }
        else { failed++; console.error("push fail", e && e.statusCode, e && e.body); }
      }
    }));
    return json({ ok: true, subscribers: blobs.length, sent, removed, failed });
  } catch (err) {
    console.error(err);
    return json({ error: String(err && err.message || err) }, 500);
  }
};

export const config = { path: "/api/push-send" };
