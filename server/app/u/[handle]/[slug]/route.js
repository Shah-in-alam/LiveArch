import { getSnapshot } from '../../../../lib/store';
import { renderViewer } from '../../../../lib/render';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /u/<handle>/<slug>  — the permanent, shareable diagram URL.
// Renders the last snapshot the CLI pushed (static; realtime is Phase 2).
export async function GET(_req, { params }) {
  const { handle, slug } = params;
  const snap = getSnapshot(handle, slug);
  if (!snap) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px">` +
      `<h1>⬡ LiveArch</h1><p>No diagram found for <code>${handle}/${slug}</code>.</p>` +
      `<p>Publish one with: <code>livearch push ${handle}/${slug} --server &lt;this-url&gt;</code></p>`,
      { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } }
    );
  }
  return new Response(renderViewer(snap), {
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}
