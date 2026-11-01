/**
 * THE PREVIEW HOST IS SERVED AS IF IT WERE AT THE MOUNT, and the mount's prefix is stripped only when
 * the path really carries it.
 *
 * The first version stripped `mount.length` characters off every path on a preview host, so a bare
 * `/api/room/<id>/ws` became `/room/<id>/ws`, matched no route, and answered 404. That is the address
 * `deploy.sh` prints as the place to exercise a change before it takes live traffic, so the one URL an
 * operator is told to use could not reach the room API at all.
 */
import { describe, expect, it } from 'vitest';
import { resolveMountPath } from './index';

const MOUNT = '/jam';

describe('resolveMountPath', () => {
  it('strips the mount on the mount host', () => {
    expect(resolveMountPath('/jam/api/room/x/ws', MOUNT, false)).toEqual({ underMount: true, path: '/api/room/x/ws' });
    expect(resolveMountPath('/jam', MOUNT, false)).toEqual({ underMount: true, path: '/' });
    expect(resolveMountPath('/jam/', MOUNT, false)).toEqual({ underMount: true, path: '/' });
  });

  it('leaves a bare path on a preview host whole instead of cutting a prefix it never had', () => {
    // THE DEFECT: this used to return '/room/x/ws', which matches no route.
    expect(resolveMountPath('/api/room/x/ws', MOUNT, true)).toEqual({ underMount: true, path: '/api/room/x/ws' });
    expect(resolveMountPath('/', MOUNT, true)).toEqual({ underMount: true, path: '/' });
  });

  it('still strips the mount when a preview host spells it out', () => {
    expect(resolveMountPath('/jam/api/room/x/ws', MOUNT, true)).toEqual({ underMount: true, path: '/api/room/x/ws' });
  });

  it('does not touch a path on the app’s own host, which the redirect branch handles', () => {
    expect(resolveMountPath('/api/room/x/ws', MOUNT, false)).toEqual({ underMount: false, path: '/api/room/x/ws' });
  });

  it('has nothing to strip when the deployment has no mount', () => {
    expect(resolveMountPath('/api/room/x/ws', '', false)).toEqual({ underMount: false, path: '/api/room/x/ws' });
  });
});
