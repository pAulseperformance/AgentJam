import { useEffect, useState, useRef, useCallback } from 'react';

/**
 * Web MIDI hook — detects hardware MIDI controllers and translates
 * MIDI note_on/note_off events into AgentJam note events.
 *
 * TAS-116: MIDI Controller Input
 */

interface MidiDevice {
  id: string;
  name: string;
  manufacturer: string;
}

interface UseMidiOptions {
  onNoteOn: (pitch: string, velocity: number) => void;
  onNoteOff: (pitch: string) => void;
  enabled?: boolean;
}

// MIDI note number → pitch string (e.g. 60 → C4)
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiNoteToPitch(noteNumber: number): string {
  const octave = Math.floor(noteNumber / 12) - 1;
  const noteName = NOTE_NAMES[noteNumber % 12];
  return `${noteName}${octave}`;
}

export function useMidi({ onNoteOn, onNoteOff, enabled = true }: UseMidiOptions) {
  const [supported, setSupported] = useState(false);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<MidiDevice[]>([]);
  const [activeDevice, setActiveDevice] = useState<string | null>(null);
  const midiAccessRef = useRef<MIDIAccess | null>(null);
  const callbacksRef = useRef({ onNoteOn, onNoteOff });

  // Keep callbacks ref fresh
  callbacksRef.current = { onNoteOn, onNoteOff };

  const handleMidiMessage = useCallback((event: MIDIMessageEvent) => {
    const data = event.data;
    if (!data || data.length < 3) return;

    const statusByte = data[0];
    const noteNum = data[1];
    const vel = data[2];
    if (statusByte === undefined || noteNum === undefined || vel === undefined) return;

    const status = statusByte & 0xf0; // strip channel

    if (status === 0x90 && vel > 0) {
      // Note On
      callbacksRef.current.onNoteOn(midiNoteToPitch(noteNum), vel);
    } else if (status === 0x80 || (status === 0x90 && vel === 0)) {
      // Note Off
      callbacksRef.current.onNoteOff(midiNoteToPitch(noteNum));
    }
  }, []);

  const updateDeviceList = useCallback((access: MIDIAccess) => {
    const deviceList: MidiDevice[] = [];
    for (const [id, input] of access.inputs) {
      deviceList.push({
        id,
        name: input.name ?? 'Unknown Device',
        manufacturer: input.manufacturer ?? 'Unknown',
      });
    }
    setDevices(deviceList);
    setConnected(deviceList.length > 0);

    // Auto-select first device if none selected
    const firstDevice = deviceList[0];
    if (firstDevice && !activeDevice) {
      setActiveDevice(firstDevice.id);
    }
  }, [activeDevice]);

  useEffect(() => {
    if (!enabled) return;

    const hasWebMidi = 'requestMIDIAccess' in navigator;
    setSupported(hasWebMidi);
    if (!hasWebMidi) return;

    let cancelled = false;

    navigator.requestMIDIAccess({ sysex: false }).then((access) => {
      if (cancelled) return;
      midiAccessRef.current = access;
      updateDeviceList(access);

      // Listen for hot-plug
      access.onstatechange = () => updateDeviceList(access);

      // Attach message handlers to all inputs
      for (const [, input] of access.inputs) {
        input.onmidimessage = handleMidiMessage;
      }
    }).catch(() => {
      setSupported(false);
    });

    return () => {
      cancelled = true;
      if (midiAccessRef.current) {
        for (const [, input] of midiAccessRef.current.inputs) {
          input.onmidimessage = null;
        }
      }
    };
  }, [enabled, handleMidiMessage, updateDeviceList]);

  return {
    supported,
    connected,
    devices,
    activeDevice,
  };
}
