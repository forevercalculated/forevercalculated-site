import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { json } from "../lib/common.mjs";

export default async (req) => {
  try {
    if (req.method === "GET") return json({ publicKey: process.env.VAPID_PUBLIC_KEY || "" });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const sub = await req.json().catch(() => null);
    if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return json({ error: "Invalid subscription" }, 400);
    }
    const key = crypto.createHash("sha256").update(sub.endpoint).digest("hex");
    await getStore({ name: "push-subs", consistency: "strong" }).setJSON(key, {
      sub: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
      createdAt: new Date().toISOString(),
    });
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Something went wrong." }, 500);
  }
};

export const config = { path: "/api/push-subscribe" };
