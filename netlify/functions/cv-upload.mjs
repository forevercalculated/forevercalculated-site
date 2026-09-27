import { getStore } from "@netlify/blobs";
import { json, emailFromRequest, userKey } from "../lib/common.mjs";

// Optional CV upload at sign up. Stored privately in Netlify Blobs, one file per member.
export default async (req) => {
  try {
    const email = emailFromRequest(req);
    if (!email) return json({ error: "Please sign in again." }, 401);
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const fd = await req.formData();
    const f = fd.get("cv");
    if (!f || typeof f === "string") return json({ error: "No file received." }, 400);
    if (fd.get("consent") !== "yes") return json({ error: "Please tick the box to confirm you want CV matched job alerts." }, 400);
    const name = String(f.name || "cv").slice(0, 120);
    if (!/\.(pdf|doc|docx)$/i.test(name)) return json({ error: "Please upload a PDF or Word document." }, 400);
    if (f.size > 5 * 1024 * 1024) return json({ error: "Your CV must be under 5MB." }, 400);
    const buf = await f.arrayBuffer();
    await getStore({ name: "cv-files", consistency: "strong" }).set(userKey(email), buf, {
      metadata: { email, name, type: f.type || "", size: f.size, uploadedAt: new Date().toISOString(), alerts: "yes", consentAt: new Date().toISOString() },
    });
    return json({ ok: true });
  } catch (err) {
    console.error(err);
    return json({ error: "Upload failed. Please try again." }, 500);
  }
};

export const config = { path: "/api/cv-upload" };
