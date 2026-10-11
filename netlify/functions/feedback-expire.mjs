import { requests, wipeUser } from "../lib/feedback.mjs";

// Daily: if a member asked for an exit survey hasn't completed it by the deadline, wipe their account anyway.
export default async () => {
  const now = Date.now();
  const s = requests(); const { blobs } = await s.list();
  let wiped = 0;
  for (const b of blobs || []) {
    try {
      const r = await s.get(b.key, { type: "json" });
      if (r && r.status === "pending" && r.wipeAfter && r.email && Date.parse(r.expiresAt) <= now) {
        await wipeUser(r.email);
        await s.setJSON(b.key, { status: "expired", firstName: r.firstName || "", expiredAt: new Date(now).toISOString() });
        wiped++;
      }
    } catch (e) { console.error("feedback-expire", b.key, e); }
  }
  return new Response(JSON.stringify({ wiped }), { headers: { "content-type": "application/json" } });
};
export const config = { schedule: "45 3 * * *" };
