// The Sales page holds prospects' emails and WhatsApp numbers, so unlike the
// rest of the app it is never open. Every sales route checks the passcode.
// No SALES_PASSCODE configured on Vercel = locked, not open.

export function salesAuthorized(req: Request): boolean {
  const expected = process.env.SALES_PASSCODE;
  if (!expected) return !process.env.VERCEL; // local dev only
  return req.headers.get("x-sales-passcode") === expected;
}

/** Vercel Cron calls with `Authorization: Bearer $CRON_SECRET`. */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
