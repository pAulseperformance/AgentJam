/**
 * THE SESSION IS THE DOOR'S, and this file only asks it.
 *
 * The fleet has one identity surface (auth.zpe.vc) and one rule about it: never add a per-app gate,
 * because a second gate is a second place to be signed out. So this app has no login of its own. It
 * forwards the visitor's cookie to the door's `GET /api/auth/get-session` and believes the answer,
 * exactly as `zpe-vc/src/worker/door.ts` and `zpe-kit`'s `session()` do for the other apps. The cookie
 * is never parsed here, and no header or query parameter can name a person.
 *
 * IT FAILS TO PUBLIC. Unlike a private page, this app has a public mode by design: a door that does
 * not answer must not empty the room, it must put the visitor in the free tier. A jam room that closes
 * itself when auth hiccups is a worse product than one that plays a cheaper agent.
 */

const DEFAULT_DOOR = 'https://auth.zpe.vc';

export interface DoorWho {
  id: string;
  name: string | null;
}

export async function doorWho(request: Request, doorUrl?: string): Promise<DoorWho | null> {
  const cookie = request.headers.get('Cookie') || '';
  // the door writes `__Secure-better-auth.session_token`; without that name there is nothing to ask
  if (!cookie.includes('better-auth')) return null;

  try {
    const init = { headers: { Cookie: cookie, Accept: 'application/json' }, cf: { cacheTtl: 0 } };
    const res = await fetch(`${doorUrl || DEFAULT_DOOR}/api/auth/get-session`, init as RequestInit);
    if (!res.ok) return null;
    const body = (await res.json()) as { user?: { id?: string; name?: string } } | null;
    if (!body?.user?.id) return null;
    return { id: body.user.id, name: body.user.name ?? null };
  } catch {
    return null;
  }
}

/** Where to send a visitor who wants the signed-in agent: the door, and back to this page after. */
export function doorSignIn(target: URL | string, doorUrl?: string): string {
  const t = typeof target === 'string' ? new URL(target) : target;
  const back = `${t.origin}${t.pathname}`;
  return `${doorUrl || DEFAULT_DOOR}/auth?next=${encodeURIComponent(back)}`;
}
