import { getStore } from "@netlify/blobs";
import { json, emailFromRequest, getMembership, userKey } from "../lib/common.mjs";
import { getStudent, studentTrialUrl } from "../lib/student.mjs";
import { reconcileStudent } from "../lib/student-flow.mjs";

async function handle(req) {
  const email = emailFromRequest(req);
  if (!email) return json({ error: "Please sign in again." }, 401);
  try {
    try {
      const act = getStore({ name: "activity", consistency: "strong" });
      const k = userKey(email);
      const prev = await act.get(k, { type: "json" });
      const now = Date.now();
      if (!prev || !prev.lastSeen || now - Date.parse(prev.lastSeen) > 30 * 60 * 1000) {
        await act.setJSON(k, { ...(prev || {}), email, lastSeen: new Date(now).toISOString(), visits: ((prev && prev.visits) || 0) + 1 });
      }
    } catch (e) { console.error("activity", e); }
    let jobAlerts = null;
    try {
      const k = userKey(email);
      const u = await getStore({ name: "users", consistency: "strong" }).get(k, { type: "json" });
      const cvMeta = (await getStore({ name: "cv-files", consistency: "strong" }).getMetadata(k)) || null;
      const meta = cvMeta && cvMeta.metadata;
      if (u && meta && meta.alerts === "yes") {
        jobAlerts = { opted: true, urgency: u.urgency || "", firstSentAt: meta.firstSentAt || null, consentAt: meta.consentAt || meta.uploadedAt || null };
      }
    } catch (e) { console.error("jobAlerts", e); }
    let student = null;
    try {
      let s = await getStudent(email);
      if (s && s.status === "awaiting_card") s = await reconcileStudent(email, s);
      if (s) student = { status: s.status, submittedAt: s.submittedAt || null, cardLater: s.cardMode === "after_approval", reason: s.status === "rejected" ? s.reason || null : null, ...(s.status === "approved_pending_card" ? { payUrl: studentTrialUrl(s.email || email) } : {}) };
    } catch (e) { console.error("student", e); }
    const mem = await getMembership(email);
    return json({ email, jobAlerts, ...mem, student });
  } catch (err) {
    console.error(err);
    return json({ email, active: false, error: "We couldn't check your plan just now. Please try again shortly." }, 503);
  }
}

export default async (req) => {
  try { return await handle(req); }
  catch (err) { console.error(err); return json({ error: "Something went wrong. Please try again." }, 500); }
};

export const config = { path: "/api/me" };
