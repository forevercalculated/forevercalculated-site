import { json, emailFromRequest } from "../lib/common.mjs";
import { SITE, stripe, getBilling, setBilling, linkCustomer, membershipFor } from "../lib/billing.mjs";
import { getStudent, setStudent, studentKey, saveIdFile, sniffType, ID_TYPES, MAX_ID_BYTES } from "../lib/student.mjs";
import { closeStudent, submitWithoutCard, isPermissionError } from "../lib/student-flow.mjs";
import { getStore } from "@netlify/blobs";

// POST /api/student-apply  (multipart form, signed in)
//   fields: institution, course, gradYear, studentId, file "studentIdFile", consents enrolled/idReview/trialTerms = "yes"
// Stores the ID privately, then sends the student to Stripe to SAVE a card (setup mode, nothing charged,
// no subscription, no trial). The trial only starts when Kenneth approves the ID in /admin/students.html.
// POST /api/student-apply?action=card      -> new card page for someone whose application is waiting for a card.
// POST /api/student-apply?action=withdraw  -> cancel the application (ID deleted, card removed) to use the standard plan.

const clean = (v, n) => String(v || "").replace(/\s+/g, " ").trim().slice(0, n);

async function cardSession(email, customerId) {
  const uk = studentKey(email);
  return stripe("POST", "checkout/sessions", {
    mode: "setup",
    currency: "gbp",
    customer: customerId,
    success_url: `${SITE}/?student=card_saved`,
    cancel_url: `${SITE}/?student=card_cancelled`,
    client_reference_id: uk,
    metadata: { email, uk, purpose: "student" },
    setup_intent_data: { metadata: { email, uk, purpose: "student" } },
    locale: "en-GB",
    custom_text: { submit: { message: "Your card is saved but NOT charged today. Your 14-day free trial starts only when we approve your student ID (within 24 hours), then £19.99 per month unless you cancel." } },
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
}

async function ensureCustomer(email, user) {
  const b = await getBilling(email);
  if (b && b.customerId) return b.customerId;
  const name = [user && user.firstName, user && user.lastName].filter(Boolean).join(" ");
  const c = await stripe("POST", "customers", { email, ...(name ? { name } : {}), metadata: { uk: studentKey(email), student: "applied" } });
  await linkCustomer(c.id, email);
  await setBilling(email, { customerId: c.id });
  return c.id;
}

async function handle(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const email = emailFromRequest(req);
  if (!email) return json({ error: "Please sign in again." }, 401);

  const action = new URL(req.url).searchParams.get("action");
  if (action === "withdraw") {
    const r = await closeStudent(studentKey(email), "withdrawn", "withdrawn by student");
    return json({ ok: true, status: r ? r.status : null });
  }
  const m = await membershipFor(email);
  if (m.billing) return json({ error: "You already have an active plan, so you don't need the student plan.", alreadyActive: true }, 409);
  const prev = await getStudent(email);
  if (prev && prev.status === "pending_review") return json({ error: "Your student ID is already being reviewed. We'll email you within 24 hours." }, 409);
  if (prev && (prev.status === "approved" || prev.status === "approved_pending_card")) return json({ error: "Your student plan has already been approved. Check your email for the link to start your trial." }, 409);
  const user = (await getStore({ name: "users", consistency: "strong" }).get(studentKey(email), { type: "json" })) || {};

  if (action === "card") {
    if (!prev || prev.status !== "awaiting_card") return json({ error: "Please fill in the student application first." }, 400);
    const customerId = await ensureCustomer(email, user);
    const s = await cardSession(email, customerId);
    await setStudent(email, { setupSessionId: s.id, customerId }, "new card page opened");
    return json({ url: s.url });
  }

  // simple abuse limit: 5 submissions a day
  const today = new Date().toISOString().slice(0, 10);
  const tries = prev && prev.triesDay === today ? prev.tries || 0 : 0;
  if (tries >= 5) return json({ error: "Too many attempts today. Please email hello@forevercalculatedcareers.com and we'll help." }, 429);

  let fd;
  try { fd = await req.formData(); } catch { return json({ error: "Your upload didn't come through. Please try again with a file under 4MB." }, 400); }
  const institution = clean(fd.get("institution"), 120), course = clean(fd.get("course"), 120), studentId = clean(fd.get("studentId"), 40);
  const gradYear = Number(fd.get("gradYear"));
  const yr = new Date().getFullYear();
  if (institution.length < 2) return json({ error: "Please enter your university or college." }, 400);
  if (course.length < 2) return json({ error: "Please enter your course." }, 400);
  if (!Number.isInteger(gradYear) || gradYear < yr || gradYear > yr + 8) return json({ error: "Please choose the year you expect to finish your course." }, 400);
  if (studentId.length < 3) return json({ error: "Please enter your student ID number." }, 400);
  if (fd.get("enrolled") !== "yes" || fd.get("idReview") !== "yes" || fd.get("trialTerms") !== "yes") return json({ error: "Please tick all three boxes to continue." }, 400);

  const f = fd.get("studentIdFile");
  if (!f || typeof f === "string" || !f.size) return json({ error: "Please attach a photo or PDF of your student ID card." }, 400);
  const ext = String(f.name || "").toLowerCase().split(".").pop();
  if (!ID_TYPES[ext]) return json({ error: "Your student ID must be a JPG, PNG, HEIC or PDF file." }, 400);
  if (f.size > MAX_ID_BYTES) return json({ error: "Your student ID file must be under 4MB. Try a smaller photo." }, 400);
  const buf = await f.arrayBuffer();
  const type = sniffType(buf);
  if (!type) return json({ error: "That file doesn't look like a photo or PDF. Please try another file." }, 400);

  const k = studentKey(email);
  const now = new Date().toISOString();
  await saveIdFile(k, buf, { email, type, size: f.size, ext, uploadedAt: now });
  const base = {
    email, firstName: user.firstName || "", lastName: user.lastName || "",
    institution, course, gradYear, studentId, hasFile: true, fileType: type,
    submittedAt: now, reason: null, decidedAt: null, tries: tries + 1, triesDay: today, consentAt: now,
  };
  let customerId, s;
  try { customerId = await ensureCustomer(email, user); s = await cardSession(email, customerId); }
  catch (e) {
    if (!isPermissionError(e)) throw e;
    // The site's Stripe key can't save cards yet: review first, card + trial after approval.
    await submitWithoutCard(email, base);
    return json({ ok: true, pending: true, cardLater: true });
  }
  await setStudent(email, { ...base, status: "awaiting_card", customerId, setupSessionId: s.id, paymentMethodId: null, cardMode: "before_review" }, prev ? "re-applied" : "applied");
  return json({ url: s.url });
}

export default async (req) => {
  try { return await handle(req); }
  catch (err) {
    console.error("student-apply", err);
    const m = String((err && err.message) || "");
    return json({ error: "We couldn't send your application just now. Please try again, or email hello@forevercalculatedcareers.com.", code: m.startsWith("Stripe") ? m.slice(0, 200) : (err && err.name) || "error" }, 500);
  }
};
export const config = { path: "/api/student-apply" };
