import { getHistory } from '../../../../../lib/store';
import { canRead } from '../../../../../lib/projects';
import { computeDiff } from '../../../../../lib/diffs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/diff/<handle>/<slug>?base=<branch>&head=<branch>&steps=<n>[&token=…]
// Compares two snapshots from the project's history (branches or revisions).
export async function GET(req, { params }) {
  const { handle, slug } = params;
  const url = new URL(req.url);
  const token = url.searchParams.get('token') || '';

  if (!(await canRead(handle, slug, token))) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const history = await getHistory(handle, slug);
  try {
    const result = computeDiff(history, {
      base: url.searchParams.get('base') || undefined,
      head: url.searchParams.get('head') || undefined,
      steps: url.searchParams.get('steps') || undefined,
    });
    return Response.json({ project: `${handle}/${slug}`, ...result });
  } catch (e) {
    const status = e.code === 'NO_DATA' ? 409 : e.code === 'REF_NOT_FOUND' ? 404 : 400;
    return Response.json({ error: e.message, code: e.code || 'ERROR' }, { status });
  }
}
