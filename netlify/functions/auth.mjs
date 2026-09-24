import { getStore } from "@netlify/blobs";
import { json, normEmail, isEmail, userKey, hashPassword, verifyPassword, signToken } from "../lib/common.mjs";

async function handle(req) {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid request." }, 400); }

  const email = normEmail(body.email);
  const password = String(body.password || "");
  if (!isEmail(email)) return json({ error: "Enter a valid email address." }, 400);
  if (password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);

  const store = getStore({ name: "users", consistency: "strong" });
  const key = userKey(email);
  const existing = await store.get(key, { type: "json" });

  if (body.action === "signup") {
    if (existing) return json({ error: "An account with this email already exists. Sign in instead." }, 409);
    const { salt, hash } = await hashPassword(password);
    await store.setJSON(key, { email, salt, hash, createdAt: new Date().toISOString() });
  } else if (body.action === "login") {
    if (!existing || !(await verifyPassword(password, existing.salt, existing.hash))) {
      return json({ error: "Email or password is incorrect." }, 401);
    }
  } else {
    return json({ error: "Invalid request." }, 400);
  }
  return json({ token: signToken(email), email });
}

export default async (req) => {
  try { return await handle(req); }
  catch (err) { console.error(err); return json({ error: "Something went wrong. Please try again." }, 500); }
};

export const config = { path: "/api/auth" };
