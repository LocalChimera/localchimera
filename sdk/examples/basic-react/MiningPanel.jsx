import React from 'react';
import { useChimera } from '../../src/useChimera.js';

/**
 * MiningPanel — drop-in component for app developers.
 * Apps only show: consent prompt, start/stop buttons, miner status.
 * Wallet and earnings are managed on the Chimera landing page.
 *
 * Usage:
 *   import MiningPanel from './MiningPanel';
 *   <MiningPanel />
 */
export default function MiningPanel() {
  const { status, consentGiven, giveConsent, revokeConsent, start, stop } = useChimera();

  const s = {
    container: { maxWidth: 360, margin: '0 auto', padding: 24, borderRadius: 16, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.02)', fontFamily: 'ui-sans-serif,system-ui,-apple-system,sans-serif', color: '#e8e2d8' },
    title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
    subtitle: { fontSize: 13, color: '#7a7468', marginBottom: 20 },
    consentBox: { background: 'rgba(0,229,255,0.05)', border: '1px solid rgba(0,229,255,0.15)', borderRadius: 12, padding: 16, marginBottom: 16 },
    consentText: { fontSize: 13, lineHeight: 1.6, marginBottom: 12 },
    btn: { width: '100%', padding: '12px 0', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 600, cursor: 'pointer', transition: 'all 0.2s' },
    btnPrimary: { background: 'linear-gradient(135deg,#00e5ff,#a855f7)', color: '#000' },
    btnSecondary: { background: 'rgba(255,255,255,0.06)', color: '#e8e2d8', border: '1px solid rgba(255,255,255,0.1)' },
    btnDanger: { background: '#450a0a', color: '#fca5a5' },
    controls: { display: 'flex', gap: 8, marginBottom: 16 },
    statusBox: { background: '#0a0a12', borderRadius: 10, padding: 12, fontSize: 12, color: '#7a7468', fontFamily: 'ui-monospace,SFMono-Regular,monospace', lineHeight: 1.6 },
    runningBadge: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: '#14532d', color: '#86efac' },
    stoppedBadge: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: '#450a0a', color: '#fca5a5' },
    minerRow: { display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }
  };

  return (
    <div style={s.container}>
      <div style={s.title}>AI Mining</div>
      <div style={s.subtitle}>Earn while your device is idle. Powered by Chimera.</div>

      {!consentGiven ? (
        <div style={s.consentBox}>
          <div style={s.consentText}>
            Enable AI mining to earn revenue from inference tasks while your device is idle.
            Manage your wallet and view earnings on the Chimera dashboard.
          </div>
          <button style={{ ...s.btn, ...s.btnPrimary }} onClick={giveConsent}>
            I agree — enable mining
          </button>
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            {status.running ? (
              <span style={s.runningBadge}>● Running</span>
            ) : (
              <span style={s.stoppedBadge}>○ Stopped</span>
            )}
          </div>

          <div style={s.controls}>
            <button
              style={{ ...s.btn, ...s.btnPrimary, flex: 1 }}
              onClick={start}
              disabled={status.running}
            >
              ▶ Start
            </button>
            <button
              style={{ ...s.btn, ...s.btnSecondary, flex: 1 }}
              onClick={stop}
              disabled={!status.running}
            >
              ⏹ Stop
            </button>
            <button
              style={{ ...s.btn, ...s.btnDanger, flex: 1 }}
              onClick={revokeConsent}
            >
              Revoke
            </button>
          </div>
        </>
      )}

      <div style={s.statusBox}>
        {Object.entries(status.miners || {}).length > 0 ? (
          Object.entries(status.miners).map(([name, m]) => (
            <div key={name} style={s.minerRow}>
              <span>{name}</span>
              <span style={{ color: m.running ? '#86efac' : '#94a3b8' }}>{m.running ? 'on' : 'off'}</span>
            </div>
          ))
        ) : (
          <div>No miners active</div>
        )}
      </div>
    </div>
  );
}
