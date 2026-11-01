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
  it('hears the backing bass and not the kit', async () => {
    const room = stub();
    await runInDurableObject(room, async (instance: JamRoom) => {
      const internals = instance as unknown as Internals;
      internals.handleSetBacking(true, true);
      const bass = [...internals.layers.values()].find(l => l.peer.instrument !== 'DrumKit')!;
      const kit = [...internals.layers.values()].find(l => l.peer.instrument === 'DrumKit')!;
      const agentId = 'agent-under-test';

      internals.recordEvent({ type: 'note_on', peerId: bass.peer.peerId, pitch: 'C2', beatTime: 0, velocity: 90, timestamp: Date.now() });
      internals.recordEvent({ type: 'note_on', peerId: kit.peer.peerId, pitch: 'A5', beatTime: 0, velocity: 58, timestamp: Date.now() });

      const heard = internals.othersRecent(agentId);
      expect(heard.map(n => n.pitch)).toContain('C2');
      // A HI-HAT IS NOT A LINE: letting it in is what made an agent refuse to play A5 in an earlier cut.
      expect(heard.map(n => n.pitch)).not.toContain('A5');
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
