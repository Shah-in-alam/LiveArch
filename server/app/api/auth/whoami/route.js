import { account } from '../../../../lib/auth';
import { planFor } from '../../../../lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/whoami  (Authorization: Bearer <token>)
export async function GET(req) {
  const acc = await account(req);
  if (!acc) return Response.json({ error: 'not authenticated' }, { status: 401 });
  const limits = planFor(acc);
  return Response.json({
    handle: acc.handle, email: acc.email, provider: acc.provider, createdAt: acc.createdAt,
    plan: acc.plan || 'free',
    limits: { maxProjects: limits.maxProjects, historyDepth: limits.historyDepth, privateProjects: limits.privateProjects, teams: limits.teams },
  });
}
