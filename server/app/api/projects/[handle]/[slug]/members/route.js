import { account as caller } from '../../../../../../lib/auth';
import { getHandleOwner } from '../../../../../../lib/accounts';
import { getMeta, addMember, removeMember, listMembers, getMemberRole } from '../../../../../../lib/projects';
import { planFor } from '../../../../../../lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ROLES = ['member', 'viewer'];

async function ownerOnly(req, handle) {
  const acc = await caller(req);
  if (!acc) return { error: 'not authenticated', status: 401 };
  const owner = await getHandleOwner(handle);
  if (!owner || acc.id !== owner) return { error: 'only the project owner can manage members', status: 403 };
  return { acc };
}

// GET — list members (owner or a member may view).
export async function GET(req, { params }) {
  const { handle, slug } = params;
  const acc = await caller(req);
  if (!acc) return Response.json({ error: 'not authenticated' }, { status: 401 });
  const owner = await getHandleOwner(handle);
  const isOwner = owner && acc.id === owner;
  const isMember = (await getMemberRole(handle, slug, acc.id)) != null;
  if (!isOwner && !isMember) return Response.json({ error: 'forbidden' }, { status: 403 });
  return Response.json({ owner: handle, members: await listMembers(handle, slug) });
}

// POST { handle: memberHandle, role? } — add/update a member (owner, Team plan).
export async function POST(req, { params }) {
  const { handle, slug } = params;
  const gate = await ownerOnly(req, handle);
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });

  // Team membership requires the owner to be on the Team plan.
  if (!planFor(gate.acc).teams) {
    return Response.json({ error: 'team members require the Team plan — run `livearch upgrade --plan team`', code: 'PLAN_REQUIRED' }, { status: 402 });
  }
  if (!(await getMeta(handle, slug))) {
    return Response.json({ error: `no such project ${handle}/${slug} — push it first` }, { status: 404 });
  }

  let body = {};
  try { body = await req.json(); } catch { /* handle required below */ }
  const memberHandle = body && body.handle;
  const role = (body && body.role) || 'member';
  if (!memberHandle) return Response.json({ error: 'member handle is required' }, { status: 400 });
  if (!ROLES.includes(role)) return Response.json({ error: 'role must be one of: ' + ROLES.join(', ') }, { status: 400 });

  const memberAccountId = await getHandleOwner(memberHandle);
  if (!memberAccountId) return Response.json({ error: `no account for handle "${memberHandle}" (they must log in once)` }, { status: 404 });
  if (memberAccountId === gate.acc.id) return Response.json({ error: 'you already own this project' }, { status: 400 });

  await addMember(handle, slug, { accountId: memberAccountId, handle: String(memberHandle).toLowerCase() }, role);
  return Response.json({ ok: true, member: memberHandle, role });
}

// DELETE { handle: memberHandle } — remove a member (owner).
export async function DELETE(req, { params }) {
  const { handle, slug } = params;
  const gate = await ownerOnly(req, handle);
  if (gate.error) return Response.json({ error: gate.error }, { status: gate.status });

  let body = {};
  try { body = await req.json(); } catch { /* handle required below */ }
  const memberHandle = body && body.handle;
  if (!memberHandle) return Response.json({ error: 'member handle is required' }, { status: 400 });
  const memberAccountId = await getHandleOwner(memberHandle);
  if (!memberAccountId) return Response.json({ error: 'no such member' }, { status: 404 });
  const ok = await removeMember(handle, slug, memberAccountId);
  return Response.json({ ok }, { status: ok ? 200 : 404 });
}
