import { findByProvider, issueToken, getHandleOwner, createAccount } from '../../../../../lib/accounts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/github/callback?code=... — finish "Sign in with GitHub".
// Exchanges the code for the GitHub user, finds-or-creates a matching account,
// issues a token, and shows it for the user to paste into `livearch login`.
export async function GET(req) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return Response.json({ error: 'GitHub OAuth is not configured', code: 'OAUTH_DISABLED' }, { status: 501 });
  }
  const code = new URL(req.url).searchParams.get('code');
  if (!code) return Response.json({ error: 'missing code' }, { status: 400 });

  // 1. Exchange the code for an access token.
  let accessToken;
  try {
    const r = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
    });
    const j = await r.json();
    accessToken = j.access_token;
  } catch (e) {
    return Response.json({ error: 'token exchange failed: ' + e.message }, { status: 502 });
  }
  if (!accessToken) return Response.json({ error: 'GitHub did not return an access token' }, { status: 401 });

  // 2. Fetch the GitHub user.
  let gh;
  try {
    const r = await fetch('https://api.github.com/user', {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'livearch' },
    });
    gh = await r.json();
  } catch (e) {
    return Response.json({ error: 'fetching GitHub profile failed: ' + e.message }, { status: 502 });
  }
  if (!gh || !gh.id) return Response.json({ error: 'invalid GitHub profile' }, { status: 502 });

  // 3. Find or create the account, then issue a token.
  let account = findByProvider('github', gh.id);
  let token;
  if (account) {
    token = issueToken(account.id, 'github-login');
  } else {
    // Pick a free handle derived from the GitHub login.
    let handle = String(gh.login || 'user').toLowerCase().replace(/[^a-z0-9._-]/g, '-');
    if (getHandleOwner(handle)) handle = `${handle}-${String(gh.id).slice(-4)}`;
    try {
      ({ account, token } = createAccount({ handle, email: gh.email || null, provider: 'github', providerId: gh.id }));
    } catch (e) {
      return Response.json({ error: 'could not create account: ' + e.message, code: e.code }, { status: 409 });
    }
  }

  // 4. Show the token to copy into the CLI.
  const html = `<!doctype html><meta charset="utf-8"><title>LiveArch — signed in</title>
<body style="font-family:system-ui;max-width:640px;margin:60px auto;padding:0 20px;color:#34302a">
<h1>⬡ Signed in as ${account.handle}</h1>
<p>Copy this token and run:</p>
<pre style="background:#f4f1ea;padding:14px;border-radius:8px;overflow:auto">livearch login --token ${token}</pre>
<p style="color:#978f80">This token is shown once. It authorises pushing diagrams under <code>${account.handle}/…</code>.</p>
</body>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
