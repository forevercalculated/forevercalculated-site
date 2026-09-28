import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const TO = "hello@forevercalculatedcareers.com";
const FROM = "Christal at Forever Careers <hello@forevercalculatedcareers.com>";
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const esc = (s) => String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  if (b.website) return json({ ok: true });
  const name = String(b.name || "").trim().slice(0, 100);
  const email = String(b.email || "").trim().toLowerCase().slice(0, 200);
  const question = String(b.question || "").trim().slice(0, 2000);
  const page = String(b.page || "").slice(0, 300);
  const transcript = (Array.isArray(b.transcript) ? b.transcript : []).slice(-20)
    .filter((m) => m && typeof m.content === "string").map((m) => ({ role: m.role === "assistant" ? "Christal" : "Visitor", content: m.content.slice(0, 800) }));
  if (!name || !isEmail(email) || !question) return json({ error: "Please add your name, a valid email and your question." }, 400);

  const store = getStore({ name: "chat-handoffs", consistency: "strong" });
  try {
    const ipk = "rl-" + crypto.createHash("sha256").update(String(context?.ip || "x")).digest("hex").slice(0, 20) + "-" + new Date().toISOString().slice(0, 10);
    const n = Number((await store.get(ipk)) || 0);
    if (n >= 5) return json({ error: "You've already sent several messages today. We'll reply by email soon." }, 429);
    await store.set(ipk, String(n + 1));
  } catch (e) {}

  const id = new Date().toISOString().replace(/[:.]/g, "-") + "-" + crypto.randomBytes(3).toString("hex");
  const record = { id, name, email, question, page, transcript, createdAt: new Date().toISOString(), emailed: false };

  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p><b>New question from the website chat (via Christal)</b></p>
<p><b>Name:</b> ${esc(name)}<br><b>Email:</b> ${esc(email)}<br><b>Page:</b> ${esc(page)}</p>
<p><b>Question:</b><br>${esc(question).replace(/\n/g, "<br>")}</p>
${transcript.length ? `<hr><p><b>Chat with Christal so far:</b></p>${transcript.map((m) => `<p><b>${m.role}:</b> ${esc(m.content).replace(/\n/g, "<br>")}</p>`).join("")}` : ""}
<hr><p style="color:#666">Reply to this email to answer ${esc(name)} directly.</p></div>`;

  const key = process.env.RESEND_API_KEY;
  if (key) {
    try {
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: "Bearer " + key, "content-type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [TO], reply_to: email, subject: `Website question from ${name}`, html }),
      });
      record.emailed = r.ok;
      if (!r.ok) record.emailError = (await r.text()).slice(0, 300);
    } catch (e) { record.emailError = String(e).slice(0, 300); }
  } else record.emailError = "RESEND_API_KEY not set";
  try { await store.setJSON("h-" + id, record); } catch (e) {}
  if (!record.emailed) console.error("handoff email failed", record.emailError);
  return json({ ok: true });
};

export const config = { path: "/api/chat-handoff" };
