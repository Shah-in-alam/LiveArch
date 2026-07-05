import { createAccount } from '../../../../lib/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST /api/auth/register  { handle, email? }
// Creates an account that claims `handle` and returns a token (shown once).
// `livearch login` calls this. Handles are first-come; re-run with a new handle
// if yours is taken, or reuse your saved token.
export async function POST(req) {
  let body;
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON body' }, { status: 400 }); }
  const { handle, email } = body || {};
  try {
    const { account, token } = await createAccount({ handle, email });
    return Response.json({
      ok: true,
      handle: account.handle,
      token, // the secret — shown once, store it (livearch keeps it in ~/.livearch)
      viewerBase: `/u/${account.handle}`,
    });
  } catch (e) {
    const status = e.code === 'HANDLE_TAKEN' ? 409 : 400;
    return Response.json({ error: e.message, code: e.code || 'ERROR' }, { status });
  }
}
