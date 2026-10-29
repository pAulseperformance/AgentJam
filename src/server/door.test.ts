import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { doorWho, doorSignIn } from './door';

describe('door', () => {
  beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
  afterEach(() => { vi.unstubAllGlobals(); });

  const withCookie = () => new Request('https://zpe.vc/jam/api/room/x/ws', {
    headers: { Cookie: '__Secure-better-auth.session_token=abc' },
  });

  it('does not ask the door when there is no session cookie', async () => {
    const who = await doorWho(new Request('https://zpe.vc/jam/'));
    expect(who).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the person the door names', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ user: { id: 'u1', name: 'Hermes Agent' } }),
    } as Response);

    expect(await doorWho(withCookie())).toEqual({ id: 'u1', name: 'Hermes Agent' });
  });

  it('forwards the cookie verbatim and never parses it', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ user: { id: 'u1' } }) } as Response);

    await doorWho(withCookie());

    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(String(url)).toBe('https://auth.zpe.vc/api/auth/get-session');
    expect((init?.headers as Record<string, string>).Cookie).toBe('__Secure-better-auth.session_token=abc');
  });

  it('fails to public when the door errors or names nobody', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, json: async () => ({}) } as Response);
    expect(await doorWho(withCookie())).toBeNull();

    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({}) } as Response);
    expect(await doorWho(withCookie())).toBeNull();

    vi.mocked(fetch).mockRejectedValue(new Error('network'));
    expect(await doorWho(withCookie())).toBeNull();
  });

  it('signs a visitor in at the door and back to the mount', () => {
    expect(doorSignIn('https://zpe.vc/jam/')).toBe(
      'https://auth.zpe.vc/auth?next=https%3A%2F%2Fzpe.vc%2Fjam%2F',
    );
  });
});
