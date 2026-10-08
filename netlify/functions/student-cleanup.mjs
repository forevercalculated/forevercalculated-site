import { listStudents } from "../lib/student.mjs";
import { closeStudent } from "../lib/student-flow.mjs";

// Daily: student IDs are never kept longer than needed.
// - card never saved after 7 days  -> application closed, ID deleted
// - not reviewed after 30 days     -> application closed, ID deleted, saved card removed
const DAY = 86400000;
export default async () => {
  const now = Date.now();
  let closed = 0;
  for (const s of await listStudents()) {
    const age = now - Date.parse(s.submittedAt || s.updatedAt || 0);
    try {
      if (s.status === "awaiting_card" && age > 7 * DAY) { await closeStudent(s.key, "expired", "expired: card never added"); closed++; }
      else if (s.status === "pending_review" && age > 30 * DAY) { await closeStudent(s.key, "expired", "expired: not reviewed in 30 days"); closed++; }
    } catch (e) { console.error("student-cleanup", s.key, e); }
  }
  return new Response(JSON.stringify({ closed }), { headers: { "content-type": "application/json" } });
};
export const config = { schedule: "30 3 * * *" };
