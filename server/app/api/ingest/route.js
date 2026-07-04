import { saveSnapshot, appendHistory } from '../../../lib/store';
import { authorizeWrite } from '../../../lib/projects';
import { publish } from '../../../lib/bus';
import { bearer } from '../../../lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/ingest  { handle, slug, arch, private? }
// Token comes from the `Authorization: Bearer` header (account token) and, for
// back-compat, from a `token` field in the body (legacy per-project token).
// The livearch CLI (`livearch push` / `livearch share`) calls this on each rebuild.
export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }
  const { handle, slug, arch } = body || {};
  const token = bearer(req) || (body && body.token) || '';

  if (!handle || !slug || !arch || !Array.isArray(arch.nodes)) {
    return Response.json({ error: 'handle, slug, and a valid arch are required' }, { status: 400 });
  }

  let meta;
  try {
    ({ meta } = authorizeWrite(handle, slug, token, { private: body.private }));
  } catch (e) {
    if (e.code === 'FORBIDDEN') return Response.json({ error: e.message, code: 'FORBIDDEN' }, { status: 403 });
    return Response.json({ error: e.message }, { status: 400 });
  }

  saveSnapshot(handle, slug, arch);
  appendHistory(handle, slug, arch);
  publish(handle + '/' + slug, { arch });
  return Response.json({ ok: true, url: `/u/${handle}/${slug}`, nodes: arch.nodes.length, visibility: meta.visibility });
}
