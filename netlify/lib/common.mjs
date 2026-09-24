import crypto from "node:crypto";

const PRODUCT_ID = "prod_VJqkXOZscHXkIM"; // ForeverCalculated Job Access
const TOKEN_DAYS = 30;

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export const normEmail = (e) => String(e || "").trim().toLowerCase();
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const userKey = (email) => crypto.createHash("sha256").update(email).digest("hex");

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => (err ? reject(err) : resolve({ salt, hash: key.toString("hex") })))
  );
}

export function verifyPassword(password, salt, hash) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) return reject(err);
      const a = Buffer.from(hash, "hex");
      resolve(a.length === key.length && crypto.timingSafeEqual(a, key));
    })
  );
}

const b64url = (s) => Buffer.from(s).toString("base64url");
const sign = (payload) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function signToken(email) {
  const payload = b64url(JSON.stringify({ e: email, x: Date.now() + TOKEN_DAYS * 86400000 }));
  return `${payload}.${sign(payload)}`;
}

export function emailFromRequest(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { e, x } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return x > Date.now() ? e : null;
  } catch { return null; }
}

async function stripeGet(path) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const res = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) throw new Error(`Stripe ${res.status}: ${await res.text()}`);
  return res.json();
}

// Looks up every Stripe customer with this email and returns the active
// subscription to our job-access product that runs the longest.
export async function getMembership(email) {
  const customers = await stripeGet(`customers?email=${encodeURIComponent(email)}&limit=20`);
  let best = null;
  for (const c of customers.data || []) {
    const subs = await stripeGet(`subscriptions?customer=${c.id}&status=all&limit=20`);
    for (const s of subs.data || []) {
      if (!["active", "trialing"].includes(s.status)) continue;
      const item = s.items?.data?.[0];
      if (item?.price?.product !== PRODUCT_ID) continue;
      const end = s.current_period_end ?? item?.current_period_end ?? 0;
      if (!best || end > best.end) {
        best = { end, plan: item?.price?.nickname || "Member", cancels: !!s.cancel_at_period_end };
      }
    }
  }
  return best
    ? { active: true, plan: best.plan, access_until: new Date(best.end * 1000).toISOString(), cancels: best.cancels }
    : { active: false };
}
