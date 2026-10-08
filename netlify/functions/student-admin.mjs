import { json, adminOk } from "../lib/common.mjs";
import { getBilling } from "../lib/billing.mjs";
import { listStudents, readIdFile, getStudentByKey } from "../lib/student.mjs";
import { approveStudent, rejectStudent } from "../lib/student-flow.mjs";

// Founder only (x-admin-key, same key as /admin).
//   GET  /api/student-admin                 -> applications (pending first)
//   GET  /api/student-admin?file=<key>      -> the uploaded student ID (only until a decision is made)
//   POST /api/student-admin {action:"approve"|"reject", key, reason?, trial?}
async function handle(req) {
  if (!adminOk(req)) return json({ error: "Not found" }, 404);
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.get("file")) {
    const k = url.searchParams.get("file");
    const got = await readIdFile(k);
    if (!got) return json({ error: "No ID file (it is deleted once a decision is made)." }, 404);
    const type = (got.metadata && got.metadata.type) || "application/octet-stream";
    return new Response(got.data, { headers: { "content-type": type, "content-disposition": "inline; filename=\"student-id\"", "cache-control": "no-store, private", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" } });
  }

  if (req.method === "GET") {
    const all = await listStudents();
    const order = { pending_review: 0, awaiting_card: 1, approved_pending_card: 2, approved: 3, rejected: 4, withdrawn: 5, expired: 6 };
    const rows = await Promise.all(all.map(async (s) => {
      const b = (await getBilling(s.email).catch(() => null)) || {};
      return {
        key: s.key, email: s.email, name: [s.firstName, s.lastName].filter(Boolean).join(" "), institution: s.institution, course: s.course,
        gradYear: s.gradYear, studentId: s.studentId, status: s.status, submittedAt: s.submittedAt, cardSavedAt: s.cardSavedAt || null,
        decidedAt: s.decidedAt || null, reason: s.reason || null, hasFile: !!s.hasFile, fileType: s.fileType || null,
        trialUsedBefore: !!b.trialUsed, planStatus: b.status || null, log: (s.log || []).slice(-6),
      };
    }));
    rows.sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(b.submittedAt).localeCompare(String(a.submittedAt)));
    return json({ pending: rows.filter((r) => r.status === "pending_review").length, rows });
  }

  if (req.method === "POST") {
    let body; try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }
    const k = String(body.key || "");
    if (!k || !(await getStudentByKey(k))) return json({ error: "Application not found." }, 404);
    let r;
    if (body.action === "approve") r = await approveStudent(k, { trial: body.trial !== false });
    else if (body.action === "reject") r = await rejectStudent(k, body.reason);
    else return json({ error: "Unknown action." }, 400);
    if (r.error) return json({ error: r.error }, r.status || 400);
    return json(r);
  }
  return json({ error: "Method not allowed" }, 405);
}

export default async (req) => {
  try { return await handle(req); }
  catch (err) { console.error("student-admin", err); return json({ error: String((err && err.message) || err).slice(0, 300) }, 500); }
};
export const config = { path: "/api/student-admin" };
