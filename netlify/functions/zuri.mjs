import { getStore } from "@netlify/blobs";
import { json, adminOk } from "../lib/common.mjs";

// Zuri's weekly Forever Times brief. Public GET; admin-only POST (Cowork updates it every Sunday).
const SEED = {
  edition: "2026-09-27",
  editionLabel: "Week ending 27 September 2026",
  nextEdition: "Sunday 4 October, 9am UK",
  hover: "Tap me once for this week's global jobs headlines. A new edition of The Forever Times lands every Sunday at 9am.",
  intro: "Here's what moved in jobs around the world this week.",
  headlines: [
    { region: "Global", text: "AI job adverts are up around 60% on last year, roughly 351,000 roles, even as overall hiring slows in most countries.", source: "Bain & Company, Sep 2026" },
    { region: "UK", text: "Job adverts held up better than most of Europe: down 9%, compared with 40% in France.", source: "Bain & Company, Sep 2026" },
    { region: "UK", text: "There are around 702,000 vacancies and more competition for each role, but pay is up 3.5%, just ahead of inflation.", source: "Learning and Work Institute, Sep 2026" },
    { region: "Global", text: "Junior job adverts fell 11% on last year, so transferable skills like data, security and AI tools matter more than ever.", source: "Bain & Company, Sep 2026" }
  ],
  tip: "Tailor your CV to every role, list the AI tools you use, and apply early.",
  updatedAt: "2026-10-02T12:00:00Z"
};

const clean = (s, n) => String(s || "").replace(/[<>]/g, "").trim().slice(0, n);

export default async (req) => {
  const store = getStore({ name: "zuri", consistency: "strong" });
  if (req.method === "GET") {
    const v = (await store.get("brief", { type: "json" })) || SEED;
    return new Response(JSON.stringify(v), { headers: { "content-type": "application/json", "cache-control": "public, max-age=300" } });
  }
  if (req.method === "POST") {
    if (!adminOk(req)) return json({ error: "unauthorised" }, 401);
    let b; try { b = await req.json(); } catch { return json({ error: "bad json" }, 400); }
    const heads = Array.isArray(b.headlines) ? b.headlines.slice(0, 8).map((h) => ({ region: clean(h.region, 40), text: clean(h.text, 320), source: clean(h.source, 120) })).filter((h) => h.text && h.source) : [];
    if (!b.edition || heads.length < 2) return json({ error: "need edition and at least 2 sourced headlines" }, 400);
    const v = { edition: clean(b.edition, 20), editionLabel: clean(b.editionLabel, 80), nextEdition: clean(b.nextEdition, 80), hover: clean(b.hover, 220), intro: clean(b.intro, 220), headlines: heads, tip: clean(b.tip, 220), updatedAt: new Date().toISOString() };
    await store.setJSON("brief", v);
    return json({ ok: true, brief: v });
  }
  return json({ error: "method" }, 405);
};
export const config = { path: "/api/zuri" };
