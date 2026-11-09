import { describe, it, expect } from 'vitest';
import worker from './index';
import { BUILD } from './build-manifest';

/**
 * THE ADDRESS STATES WHICH BUILD RENDERS IT, AND SAYS THAT IS ALL IT CLAIMS.
 *
 * This worker composes its page per request, so there is no byte string to hash: the manifest beside
 * the address attests the build. These tests hold the three things a reader is promised: the manifest
 * answers at the mount, it carries the same signed constant the tree was signed with, and it names the
 * version serving it while declaring that field unsigned.
 *
 * Measured before this change (2026-11-07): `GET /jam/index.json` answered 404, because no such route
 * existed. The first test here is the one that failed.
 */

const MANIFEST = BUILD as unknown as Record<string, unknown>;

const env = (meta?: { id: string; timestamp: string }) => ({
  PATH_PREFIX: '/jam',
  MOUNT_ORIGIN: 'https://zpe.vc',
  CANONICAL_HOST: 'jam.zpe.vc',
  CF_VERSION_METADATA: meta,
});

const get = (path: string, meta?: { id: string; timestamp: string }) =>
  worker.fetch(new Request(`https://zpe.vc${path}`), env(meta) as never);

describe('the build manifest at /jam/index.json', () => {
  it('answers at the mount, as JSON', async () => {
    const res = await get('/jam/index.json');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  it('serves the constant this tree was signed with, and says it is a build', async () => {
    const man = await (await get('/jam/index.json')).json();
    expect(man.id).toBe('zpe:jam');
    expect(man.mode).toBe('build');
    expect(man.digest).toBe(MANIFEST.digest);
    expect(man.version).toBe(MANIFEST.version);
  });

  it('says what it does not attest, so no reader compares bytes it cannot compute', async () => {
    const man = await (await get('/jam/index.json')).json();
    expect(man.attests).toBe('the build that renders this address');
    expect(man.does_not_attest).toBe('the bytes served for one request');
    expect(man.unsigned_fields).toContain('served_by');
  });

  it('names the version serving it, from the platform metadata binding', async () => {
    const man = await (
      await get('/jam/index.json', { id: 'abc-123', timestamp: '2026-11-07T00:00:00Z' })
    ).json();
    expect(man.served_by).toEqual({ version_id: 'abc-123', created_at: '2026-11-07T00:00:00Z' });
  });

  it('answers null where the platform reports nothing, rather than inventing an id', async () => {
    const man = await (await get('/jam/index.json')).json();
    expect(man.served_by).toBeNull();
  });
});
