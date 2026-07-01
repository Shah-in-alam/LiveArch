import { getSnapshot } from '../../../../lib/store';
import { canRead } from '../../../../lib/projects';
import { renderViewer } from '../../../../lib/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /u/<handle>/<slug>[?token=…] — the permanent, shareable diagram URL.
// Renders the last snapshot and (for hosted mode) subscribes to live updates.
export async function GET(req, { params }) {
  const { handle, slug } = params;
  const token = new URL(req.url).searchParams.get('token') || '';

  if (!canRead(handle, slug, token)) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">` +
      `<h1>⬡ LiveArch</h1><p>This diagram is <b>private</b>. Append a valid <code>?token=…</code> to view it.</p>`,
      { status: 403, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }

  const snap = getSnapshot(handle, slug);
  if (!snap) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">` +
      `<h1>⬡ LiveArch</h1><p>No diagram found for <code>${handle}/${slug}</code>.</p>` +
      `<p>Publish one with: <code>livearch push ${handle}/${slug} --server &lt;this-url&gt;</code></p>`,
      { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response(renderViewer(snap, { handle, slug, token }), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
