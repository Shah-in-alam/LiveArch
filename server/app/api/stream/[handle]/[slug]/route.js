import { getSnapshot } from '../../../../lib/store';
import { subscribe } from '../../../../lib/bus';
import { canRead } from '../../../../lib/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/stream/<handle>/<slug>[?token=…] — SSE stream of live updates.
// The hosted viewer opens this; each `livearch share` push fans out here.
export async function GET(req, { params }) {
  const { handle, slug } = params;
  const token = new URL(req.url).searchParams.get('token') || '';
  if (!(await canRead(handle, slug, token))) {
    return new Response('forbidden', { status: 403 });
  }
  const key = handle + '/' + slug;
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const send = (obj) => {
        try { controller.enqueue(enc.encode('data: ' + JSON.stringify(obj) + '\n\n')); } catch { /* closed */ }
      };
      // Subscribe first so no update is missed while the snapshot loads.
      const unsub = subscribe(key, (data) => send({ type: 'update', arch: data.arch, event: 'change' }));
      const keepAlive = setInterval(() => {
        try { controller.enqueue(enc.encode(': keep-alive\n\n')); } catch { /* closed */ }
      }, 25000);

      req.signal.addEventListener('abort', () => {
        clearInterval(keepAlive);
        unsub();
        try { controller.close(); } catch { /* already closed */ }
      });

      // Send the current snapshot immediately, then live updates follow.
      (async () => {
        const snap = await getSnapshot(handle, slug);
        if (snap) send({ type: 'update', arch: snap.arch });
      })();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
    },
  });
}
