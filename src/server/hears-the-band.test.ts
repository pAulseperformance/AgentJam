/**
 * AN AGENT HAS TO HEAR THE BAND IT IS PLAYING WITH.
 *
 * `othersRecent` filtered on `isPlayerPeer`, which answers "is this a person at a keyboard" and is
 * false for every agent and every backing layer. So a signed agent joining a room where a bass and a
 * drummer had been playing for a minute was told, nine bars running, that "the room is silent, nobody
 * has played recently", and took the lead because nobody was playing. What he heard: a solo played
 * over a band the soloist cannot hear.
 *
 * The kit stays out (a fixed figure on fixed pitches is not a line to answer). Everything else is in.
 */
import { env, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { JamRoom } from './jam-room';

interface Internals {
  layers: Map<string, { peer: { peerId: string; instrument?: string } }>;
  agents: Map<string, { peer: { peerId: string } }>;
  recordEvent: (e: Record<string, unknown>) => void;
  othersRecent: (peerId: string) => Array<{ peerId: string; pitch: string }>;
  handleSetBacking: (drummer: boolean, bass: boolean) => void;
}

const stub = () => {
  const typedEnv = env as any;
  return typedEnv.JAM_ROOM.get(typedEnv.JAM_ROOM.idFromName(`hear-${crypto.randomUUID()}`));
};

describe('what an agent hears', () => {
  it('keeps the rhythm section out of the phrase it answers, and says it is there in words', async () => {
    // LETTING THE BASS IN WAS TRIED AND THE ROOM'S OWN GATE REFUSED IT: `C2 G2` landed in 34 of 87
    // prompts as "strong beats". The section's notes are not a line to answer; that it is PLAYING is a
    // fact the model needs, and it gets it from `sectionLine()` with no pitch in it.
    const room = stub();
    await runInDurableObject(room, async (instance: JamRoom) => {
      const internals = instance as unknown as Internals & { sectionLine: () => string | undefined };
      internals.handleSetBacking(true, true);
      const bass = [...internals.layers.values()].find(l => l.peer.instrument !== 'drum-kit')!;
      const kit = [...internals.layers.values()].find(l => l.peer.instrument === 'drum-kit')!;

      internals.recordEvent({ type: 'note_on', peerId: bass.peer.peerId, pitch: 'C2', beatTime: 0, velocity: 90, timestamp: Date.now() });
      internals.recordEvent({ type: 'note_on', peerId: kit.peer.peerId, pitch: 'A5', beatTime: 0, velocity: 58, timestamp: Date.now() });

      const heard = internals.othersRecent('agent-under-test').map(n => n.pitch);
      expect(heard).not.toContain('C2');
      expect(heard).not.toContain('A5');

      // A HI-HAT IS NOT A LINE and neither is a kick, but the model is still told a band is playing.
      const section = internals.sectionLine();
      expect(section).toContain('drummer');
      expect(section).toContain('bass');
      expect(section).not.toMatch(/[A-G]#?\d/);
    });
  });

  it('hears another agent, because two agents in a room are a duet', async () => {
    const room = stub();
    await runInDurableObject(room, async (instance: JamRoom) => {
      const internals = instance as unknown as {
        recordEvent: (e: Record<string, unknown>) => void;
        othersRecent: (peerId: string) => Array<{ pitch: string }>;
      };
      internals.recordEvent({ type: 'note_on', peerId: 'other-agent', pitch: 'G4', beatTime: 1, velocity: 90, timestamp: Date.now() });
      expect(internals.othersRecent('agent-under-test').map(n => n.pitch)).toContain('G4');
      // And never itself: an agent answering its own last bar is a loop, not a conversation.
      expect(internals.othersRecent('other-agent').map(n => n.pitch)).not.toContain('G4');
    });
  });
});
