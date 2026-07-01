import { saveSnapshot } from '../../../lib/store';
import { checkToken } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/ingest  { handle, slug, arch, token }
// The livearch CLI (`livearch push` / `livearch share`) calls this on each rebuild.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { handle, slug, arch, token } = body || {};

  if (!checkToken(token)) {
    return Response.json({ error: 'unauthorized', code: 'BAD_TOKEN' }, { status: 401 });
  }
  if (!handle || !slug || !arch || !Array.isArray(arch.nodes)) {
    return Response.json({ error: 'handle, slug, and a valid arch are required' }, { status: 400 });
  }

  try {
    const saved = saveSnapshot(handle, slug, arch);
    // Phase 2 will also publish to a realtime channel here.
    return Response.json({ ok: true, url: `/u/${saved.handle}/${saved.slug}`, nodes: arch.nodes.length });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
}
