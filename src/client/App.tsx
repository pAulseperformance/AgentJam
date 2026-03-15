import { useState } from 'react';
import { JamRoom } from './pages/JamRoom';

/**
 * Root App — minimal landing that routes to a JamRoom.
 * Phase 1: simple room join form. Phase 2: auth + room browser.
 */
export function App() {
  const [joined, setJoined] = useState(false);
  const [playerName, setPlayerName] = useState('');
  const [roomId, setRoomId] = useState('default-room');

  if (joined) {
    return <JamRoom roomId={roomId} playerName={playerName || 'Anonymous'} />;
  }

  return (
    <div className="landing">
      <div className="landing__card">
        <h1 className="landing__title">🎵 AgentJam</h1>
        <p className="landing__subtitle">
          Real-time collaborative jam room — humans and AI agents, together.
        </p>

        <form
          className="landing__form"
          onSubmit={(e) => {
            e.preventDefault();
            setJoined(true);
          }}
        >
          <div className="landing__field">
            <label htmlFor="player-name" className="landing__label">Your Name</label>
            <input
              id="player-name"
              className="landing__input"
              type="text"
              placeholder="Enter your name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="landing__field">
            <label htmlFor="room-id" className="landing__label">Room</label>
            <input
              id="room-id"
              className="landing__input"
              type="text"
              placeholder="Room name"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
          </div>

          <button
            type="submit"
            className="landing__join-btn"
            id="join-room"
          >
            Join Room →
          </button>
        </form>
      </div>
    </div>
  );
}
