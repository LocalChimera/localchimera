import React from 'react';
import MiningPanel from './MiningPanel';

/**
 * Example app integrating the Chimera SDK.
 * Apps only show consent + start/stop.
 * Wallet and earnings are managed on the Chimera dashboard.
 */
export default function App() {
  return (
    <div style={{
      minHeight: '100vh',
      background: '#030308',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24
    }}>
      <MiningPanel />
    </div>
  );
}
