import { describe, it, expect } from 'vitest';
import {
  ClientMessageSchema,
  ServerMessageSchema,
  RoomStateSchema,
  PeerSchema,
} from './types';

describe('Protocol Types Validation', () => {
  describe('ClientMessageSchema', () => {
    it('accepts valid join_room', () => {
      const msg = {
        type: 'join_room',
        name: 'TestUser',
        kind: 'human',
        instrument: 'Piano',
      };
      expect(ClientMessageSchema.safeParse(msg).success).toBe(true);
    });

    it('accepts valid note_on with all fields', () => {
      const msg = {
        type: 'note_on',
        peerId: 'peer-1',
        pitch: 'C4',
        beatTime: 1.5,
        velocity: 100,
        timestamp: 1234567890,
      };
      expect(ClientMessageSchema.safeParse(msg).success).toBe(true);
    });

    it('rejects note_on with velocity > 127', () => {
      const msg = {
        type: 'note_on',
        peerId: 'peer-1',
        pitch: 'C4',
        beatTime: 1.5,
        velocity: 150, // Invalid
        timestamp: 1234567890,
      };
      const result = ClientMessageSchema.safeParse(msg);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('less than or equal to 127');
      }
    });

    it('rejects unknown type (discriminated union)', () => {
      const msg = {
        type: 'unknown_type',
        foo: 'bar',
      };
      expect(ClientMessageSchema.safeParse(msg).success).toBe(false);
    });

    it('accepts set_agent_model', () => {
      const msg = {
        type: 'set_agent_model',
        agentPeerId: 'agent-1',
        model: '@cf/meta/llama-3.1-8b',
      };
      expect(ClientMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe('ServerMessageSchema', () => {
    it('accepts valid room_state', () => {
      const msg = {
        type: 'room_state',
        roomState: {
          bpm: 120,
          key: 'C major',
          transportStartTime: 1000,
          serverTime: 2000,
        },
        peers: [],
      };
      expect(ServerMessageSchema.safeParse(msg).success).toBe(true);
    });
  });

  describe('RoomStateSchema', () => {
    it('rejects BPM outside 20-300', () => {
      const state1 = { bpm: 10, key: 'C', transportStartTime: 0, serverTime: 0 };
      const state2 = { bpm: 400, key: 'C', transportStartTime: 0, serverTime: 0 };
      
      expect(RoomStateSchema.safeParse(state1).success).toBe(false);
      expect(RoomStateSchema.safeParse(state2).success).toBe(false);
    });
  });

  describe('PeerSchema', () => {
    it('validates all required fields', () => {
      const peer = {
        peerId: '123',
        name: 'Alice',
        kind: 'human',
        instrument: 'Synth',
        color: '#ff0000',
      };
      expect(PeerSchema.safeParse(peer).success).toBe(true);

      const invalidPeer = {
        peerId: '123',
        name: 'Alice',
        // missing kind, instrument, color
      };
      expect(PeerSchema.safeParse(invalidPeer).success).toBe(false);
    });
  });
});
