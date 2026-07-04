import { account } from '../../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/whoami  (Authorization: Bearer <token>)
export async function GET(req) {
  const acc = account(req);
  if (!acc) return Response.json({ error: 'not authenticated' }, { status: 401 });
  return Response.json({ handle: acc.handle, email: acc.email, provider: acc.provider, createdAt: acc.createdAt });
}
