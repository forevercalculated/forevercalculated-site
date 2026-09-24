import { json, emailFromRequest, getMembership } from "../lib/common.mjs";

async function handle(req) {
  const email = emailFromRequest(req);
  if (!email) return json({ error: "Please sign in again." }, 401);
  try {
    return json({ email, ...(await getMembership(email)) });
  } catch (err) {
    console.error(err);
    return json({ email, active: false, error: "We couldn't check your plan just now. Please try again shortly." }, 503);
  }
}

export default async (req) => {
  try { return await handle(req); }
  catch (err) { console.error(err); return json({ error: "Something went wrong. Please try again." }, 500); }
};

export const config = { path: "/api/me" };
