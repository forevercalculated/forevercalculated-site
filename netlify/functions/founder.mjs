import crypto from "node:crypto";
import { json } from "../lib/common.mjs";
import jobs from "../lib/jobs-data.mjs";

// Private founder access. Set FOUNDER_KEY in Netlify to enable; otherwise always "Not found".
export default async (req) => {
  const key = process.env.FOUNDER_KEY || "";
  const k = new URL(req.url).searchParams.get("k") || "";
  const a = Buffer.from(k), b = Buffer.from(key);
  if (!key || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return json({ error: "Not found" }, 404);
  const urls = {};
  jobs.forEach((j) => { urls[j.id] = j.url; });
  return json({ urls });
};

export const config = { path: "/api/founder" };
