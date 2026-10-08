// Student plan: £19.99/month, 14-day free trial that only starts once Kenneth approves the student ID.
// Records live in the private "students" store; ID files in the private "student-ids" store and are
// deleted as soon as a decision is made (or after 30 days if never reviewed).
import { getStore } from "@netlify/blobs";
import { userKey, normEmail } from "./common.mjs";

export const STUDENT_PRICE_ID = process.env.STUDENT_PRICE_ID || "price_1UOHWSIzGjJjQQytPDzjZr6h"; // £19.99 / month, same product as the £50 plan
export const STUDENT_PRICE_TEXT = "£19.99";
export const reviewInbox = () => process.env.STUDENT_REVIEW_EMAIL || "hello@forevercalculatedcareers.com";

// awaiting_card -> pending_review -> approved | rejected   (expired = never finished / never reviewed in 30 days)
export const BLOCKING = ["awaiting_card", "pending_review"];
export const ID_TYPES = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", heif: "image/heif" };
export const MAX_ID_BYTES = 4 * 1024 * 1024; // Netlify function bodies are capped at 6MB

const recs = () => getStore({ name: "students", consistency: "strong" });
const files = () => getStore({ name: "student-ids", consistency: "strong" });

export const studentKey = (email) => userKey(normEmail(email));
export const getStudentByKey = async (k) => (k ? (await recs().get(k, { type: "json" })) || null : null);
export const getStudent = async (email) => getStudentByKey(studentKey(email));

export async function setStudentByKey(k, patch, event) {
  const prev = (await recs().get(k, { type: "json" })) || {};
  const now = new Date().toISOString();
  const log = Array.isArray(prev.log) ? prev.log.slice(-29) : [];
  if (event) log.push({ at: now, event });
  const next = { ...prev, ...patch, updatedAt: now, log };
  await recs().setJSON(k, next);
  return next;
}
export const setStudent = (email, patch, event) => setStudentByKey(studentKey(email), patch, event);

export async function listStudents() {
  const st = recs();
  const page = await st.list();
  const out = [];
  await Promise.all((page.blobs || []).map(async (b) => { const v = await st.get(b.key, { type: "json" }); if (v) out.push({ key: b.key, ...v }); }));
  return out.sort((a, b) => String(b.submittedAt || "").localeCompare(String(a.submittedAt || "")));
}

export const saveIdFile = (k, buf, metadata) => files().set(k, buf, { metadata });
export const readIdFile = (k) => files().getWithMetadata(k, { type: "arrayBuffer" });
export const deleteIdFile = (k) => files().delete(k).catch(() => {});

// Check the real file contents, not just the name.
export function sniffType(bytes) {
  const b = new Uint8Array(bytes.slice(0, 16));
  const s = (i, str) => [...str].every((c, j) => b[i + j] === c.charCodeAt(0));
  if (s(0, "%PDF")) return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && s(1, "PNG")) return "image/png";
  if (s(0, "RIFF") && s(8, "WEBP")) return "image/webp";
  if (s(4, "ftyp")) return "image/heic"; // HEIC/HEIF photos from iPhones
  return null;
}

export const maskId = (v) => { const t = String(v || ""); return t.length <= 4 ? "****" : "*".repeat(Math.min(t.length - 4, 8)) + t.slice(-4); };

// Applied on top of the normal membership rules: someone whose student ID is waiting for
// review has no access (no roles, no job alerts) unless they already pay or trial on Stripe.
export function studentGate(member, student, billing) {
  if (!student || !BLOCKING.includes(student.status)) return member;
  const st = billing && billing.status;
  if (st === "trialing" || st === "active" || st === "past_due") return member;
  return {
    active: false, free: false, needsCard: false, studentReview: true,
    student: { status: student.status },
    plan: student.status === "awaiting_card" ? "Student application not finished" : "Student ID under review",
  };
}
