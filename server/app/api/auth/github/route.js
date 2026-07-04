export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/auth/github — begin "Sign in with GitHub".
// Enabled only when GITHUB_CLIENT_ID is configured; otherwise returns 501 with
// setup instructions. This is the drop-in for real OAuth accounts (the design
// doc's Phase-3 auth); the register/token flow works without it.
export async function GET(req) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return Response.json({
      error: 'GitHub OAuth is not configured on this server.',
      code: 'OAUTH_DISABLED',
      howto: 'Register an OAuth app at https://github.com/settings/developers, then set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET (callback: <origin>/api/auth/github/callback).',
    }, { status: 501 });
  }
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/auth/github/callback`;
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'read:user');
  url.searchParams.set('allow_signup', 'true');
  return Response.redirect(url.toString(), 302);
}
