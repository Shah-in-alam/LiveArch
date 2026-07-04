import { account } from '../../../../lib/auth';
import { listTokens, issueToken, revokeToken } from '../../../../lib/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/tokens — list this account's tokens (metadata only).
export async function GET(req) {
  const acc = account(req);
  if (!acc) return Response.json({ error: 'not authenticated' }, { status: 401 });
  return Response.json({ tokens: listTokens(acc.id) });
}

// POST /api/auth/tokens  { name? } — issue a new token (returned once).
export async function POST(req) {
  const acc = account(req);
  if (!acc) return Response.json({ error: 'not authenticated' }, { status: 401 });
  let body = {};
  try { body = await req.json(); } catch { /* name optional */ }
  const token = issueToken(acc.id, (body && body.name) || 'token');
  return Response.json({ ok: true, token });
}

// DELETE /api/auth/tokens  { tokenHash } — revoke one of this account's tokens.
export async function DELETE(req) {
  const acc = account(req);
  if (!acc) return Response.json({ error: 'not authenticated' }, { status: 401 });
  let body = {};
  try { body = await req.json(); } catch { /* need tokenHash */ }
  const ok = revokeToken(acc.id, body && body.tokenHash);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
