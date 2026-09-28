import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

const MODEL = "claude-haiku-4-5-20251001";
const MAX_MSGS = 12, MAX_CHARS = 800, PER_HOUR = 40;

const SYSTEM = `You are David, the AI assistant on the Forever Careers website (forevercalculatedcareers.com). You are an AI, not a person. If anyone asks whether you are human or a bot, say plainly that you are Forever Careers' AI assistant, and that they can tap "Talk to a person" to reach the team.

STYLE
- Friendly, clear, UK English. Plain text only: no markdown, no asterisks, no headings. Short paragraphs.
- Keep answers under 80 words unless the visitor asks for more detail.
- Only state facts listed below. Never invent prices, dates, policies or features. If you are not sure, or the question is about a specific account, payment, refund or complaint, say you'll pass it to the team and suggest tapping "Talk to a person" (the team replies by email within 24 hours).
- Stay on topic: Forever Careers and general job-hunting tips (CVs, applications, interviews). Politely decline anything unrelated.
- Never ask for card details or passwords.

ABOUT FOREVER CAREERS
- UK-based career support service covering remote, hybrid and in-person roles. Director: Kenneth Nzegbulem. Contact: hello@forevercalculatedcareers.com, or Instagram/TikTok @forevercalculatedcareers.
- Live roles across 19 countries, including the UK, US, Canada, Australia, New Zealand, Singapore, South Africa, India and much of Europe and Latin America. Some roles can only be opened by people located in that country.
- Browsing live roles and the free CV checker are free. The CV checker matches keywords in your CV against today's live roles; it's a starting point, not a guarantee of a match.

MEMBERSHIP (job matches)
- Signing up starts a 14-day free trial, then £50 per month. Card details are entered at sign-up but not charged today; the first payment is taken automatically when the trial ends unless you cancel before then.
- Cancel any time from your account page. If a payment fails it is retried once; if it still fails the account is cancelled.
- Members can upload their CV (PDF or Word) and get job matches emailed twice a day, morning and evening. A Forever Careers agent may follow up. Reply "stop" to any match email to stop them.
- Sign-up problems: email hello@forevercalculatedcareers.com.

OPTIONAL PAID SERVICES (one-off payments, priced in local currency where available, paid securely via Stripe)
- CV Optimisation: 1 tailored CV £49, or 3 tailored CVs for 3 industries £99. Delivered within 24 hours of the order being confirmed.
- Forever Careers Agent: £199 for 30 days. 10 hand-picked roles a day checked against your CV, help tailoring and sending applications, weekly check-in.
- Tailored cover letter £25 (within 24 hours). LinkedIn rewrite £39 (within 48 hours). Written CV review £19 (within 24 hours). Interview prep £39 for a 45-minute call.
- Refer a friend: £20 by bank transfer when a friend you refer pays for a service and names you in the "Referred by a friend" box.

POLICIES
- Refunds: full refund if we don't deliver the service paid for. Once delivered, services are non-refundable. Problems: email hello@forevercalculatedcareers.com.
- No guarantee of an interview or job.
- Visa sponsorship: mention it in the job readiness questionnaire so the agent takes it into account.
- Data: never sold. Visitors can ask to see or delete their data by emailing hello@forevercalculatedcareers.com.
- Abuse toward the team is not tolerated.`;

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function limited(ip) {
  try {
    const store = getStore({ name: "chat-limits", consistency: "strong" });
    const key = crypto.createHash("sha256").update(String(ip || "x")).digest("hex").slice(0, 24) + "-" + new Date().toISOString().slice(0, 13);
    const n = Number((await store.get(key)) || 0);
    if (n >= PER_HOUR) return true;
    await store.set(key, String(n + 1));
  } catch (e) {}
  return false;
}

export default async (req, context) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return json({ error: "Chat is not available right now." }, 503);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  let msgs = Array.isArray(body?.messages) ? body.messages : [];
  msgs = msgs
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }))
    .slice(-MAX_MSGS);
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  if (!msgs.length || msgs[msgs.length - 1].role !== "user") return json({ error: "Bad request" }, 400);
  if (await limited(context?.ip)) return json({ reply: "You've sent a lot of messages in a short time. Please tap \"Talk to a person\" and the team will reply by email within 24 hours." });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 350,
        system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: msgs,
      }),
    });
    const d = await r.json();
    if (!r.ok) { console.error("anthropic", r.status, JSON.stringify(d).slice(0, 300)); return json({ reply: "Sorry, I'm having trouble right now. Tap \"Talk to a person\" and the team will reply by email within 24 hours." }); }
    const reply = (d.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    return json({ reply: reply || "Sorry, I didn't catch that. Could you rephrase?" });
  } catch (e) {
    console.error(e);
    return json({ reply: "Sorry, I'm having trouble right now. Tap \"Talk to a person\" and the team will reply by email within 24 hours." });
  }
};

export const config = { path: "/api/chat" };
