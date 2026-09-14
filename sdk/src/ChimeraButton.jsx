/**
 * ChimeraButton — One-line integration for Chimera SDK.
 *
 * Just drop <ChimeraButton /> anywhere in your app. It handles:
 *   - Wallet connection (EVM via ConnectKit, Solana via Solana Wallet Adapter)
 *   - Message signing and backend JWT verification for EVM/Solana
 *   - Web3Auth MPC wallet creation for EVM/Solana
 *   - User consent flow
 *   - Start/stop mining (container or browser mode)
 *   - Live status display (jobs, earnings, network adapters)
 *   - All styling (self-contained, no CSS needed)
 *
 * Usage:
 *   import { ChimeraButton } from '@localchimera/sdk';
 *
 *   function App() {
 *     return <ChimeraButton appDeveloperEVM="0xYourEVMAddress" />;
 *   }
 *
 * That's it. No wrapping, no hooks, no state management.
 * Revenue split defaults to 70% machine owner / 30% app developer.
 */

import { useState, useEffect, useRef, createElement, Fragment } from 'react';
import { useChimera, ChimeraWeb3AuthProvider } from './useChimera.js';

// ─── Styles (inline, no external CSS needed) ───────────────────────

const STYLES = {
  container: {
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'inline-flex',
    flexDirection: 'column',
    gap: '8px',
    maxWidth: '420px',
  },
  button: {
    padding: '10px 20px',
    borderRadius: '10px',
    border: 'none',
    fontSize: '14px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minWidth: '180px',
  },
  primary: { background: '#6366f1', color: '#fff' },
  primaryHover: { background: '#4f46e5' },
  success: { background: '#22c55e', color: '#fff' },
  successHover: { background: '#16a34a' },
  danger: { background: '#ef4444', color: '#fff' },
  dangerHover: { background: '#dc2626' },
  neutral: { background: '#e5e7eb', color: '#374151' },
  neutralHover: { background: '#d1d5db' },
  status: {
    fontSize: '12px',
    color: '#6b7280',
    padding: '6px 10px',
    background: '#f9fafb',
    borderRadius: '8px',
    display: 'flex',
    flexWrap: 'wrap',
    gap: '4px 12px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    padding: '2px 8px',
    borderRadius: '6px',
    fontSize: '11px',
    fontWeight: 500,
  },
  badgeGreen: { background: '#dcfce7', color: '#166534' },
  badgeBlue: { background: '#dbeafe', color: '#1e40af' },
  badgeGray: { background: '#f3f4f6', color: '#6b7280' },
  badgeOrange: { background: '#fed7aa', color: '#9a3412' },
  networkGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
    gap: '4px',
    marginTop: '4px',
  },
  networkItem: {
    fontSize: '11px',
    padding: '3px 6px',
    borderRadius: '4px',
    background: '#f3f4f6',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  dot: { width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block' },
  dotGreen: { background: '#22c55e' },
  dotGray: { background: '#d1d5db' },
};

// ─── Inner component (uses useChimera inside ChimeraWeb3AuthProvider) ────────

function ChimeraButtonInner({ appDeveloperEVM, revenueSplit, onStatusChange, chain = 'evm', mpcBaseUrl }) {
  const chimera = useChimera({ appDeveloperEVM, revenueSplit, mpcBaseUrl });
  const [hover, setHover] = useState(false);
  const prevStatusRef = useRef(null);

  useEffect(() => {
    if (onStatusChange && chimera.status !== prevStatusRef.current) {
      prevStatusRef.current = chimera.status;
      onStatusChange(chimera.status);
    }
  }, [chimera.status, onStatusChange]);

  const running = chimera.status?.running;
  const jobsProcessed = chimera.status?.providers?.reduce((a, p) => a + (p.jobsProcessed || 0), 0) || 0;
  const jobsFailed = chimera.status?.providers?.reduce((a, p) => a + (p.jobsFailed || 0), 0) || 0;
  const earnings = chimera.status?.providers?.reduce((a, p) => a + (p.earningsMotes || 0), 0) || 0;
  const networkAdapters = chimera.status?.networkAdapters || [];

  // Determine button state and style
  let btnStyle, btnText, onClick, disabled = false;

  if (!chimera.walletConnected) {
    btnStyle = { ...STYLES.button, ...STYLES.primary, ...(hover ? STYLES.primaryHover : {}) };
    btnText = 'Connect Wallet';
    onClick = () => chimera.connectWallet(chain);
  } else if (!chimera.consentGiven) {
    btnStyle = { ...STYLES.button, ...STYLES.neutral, ...(hover ? STYLES.neutralHover : {}) };
    btnText = 'Enable Mining';
    onClick = chimera.giveConsent;
  } else if (running) {
    btnStyle = { ...STYLES.button, ...STYLES.danger, ...(hover ? STYLES.dangerHover : {}) };
    btnText = 'Stop Mining';
    onClick = chimera.stop;
  } else {
    btnStyle = { ...STYLES.button, ...STYLES.success, ...(hover ? STYLES.successHover : {}) };
    btnText = 'Start Mining';
    onClick = chimera.start;
  }

  const formatEarnings = (motes) => {
    if (!motes || motes === '0') return '0';
    const cspr = Number(motes) / 1e9;
    return cspr < 0.01 ? '<0.01' : cspr.toFixed(2);
  };

  return createElement('div', { style: STYLES.container },
    // Main button
    createElement('button', {
      style: btnStyle,
      onClick,
      disabled,
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
    }, btnText),

    // Status bar (only when wallet connected)
    chimera.walletConnected && createElement('div', { style: STYLES.status },
      createElement('span', null, chimera.walletAddress?.slice(0, 6) + '...' + chimera.walletAddress?.slice(-4)),
      running && createElement('span', { style: { ...STYLES.badge, ...STYLES.badgeGreen } },
        createElement('span', { style: { ...STYLES.dot, ...STYLES.dotGreen } }), 'Running'
      ),
      chimera.browserMode && createElement('span', { style: { ...STYLES.badge, ...STYLES.badgeBlue } }, 'Browser'),
      !chimera.browserMode && chimera.status?.containerized && createElement('span', { style: { ...STYLES.badge, ...STYLES.badgeBlue } }, 'Container'),
      jobsProcessed > 0 && createElement('span', null, `Jobs: ${jobsProcessed}`),
      jobsFailed > 0 && createElement('span', { style: { color: '#ef4444' } }, `Failed: ${jobsFailed}`),
      earnings > 0 && createElement('span', null, `Earned: ${formatEarnings(earnings)} CSPR`),
    ),

    // Network adapters status (when running)
    running && networkAdapters.length > 0 && createElement('div', { style: STYLES.networkGrid },
      ...networkAdapters.map(adapter =>
        createElement('div', { key: adapter.network, style: STYLES.networkItem },
          createElement('span', null, adapter.network),
          createElement('span', { style: { ...STYLES.badge, ...(adapter.running ? STYLES.badgeGreen : STYLES.badgeGray) } },
            adapter.running ? `${adapter.jobsServed} jobs` : 'idle'
          ),
        )
      ),
    ),

    // SDK update notice
    chimera.sdkUpdate?.updateAvailable && createElement('div', {
      style: { fontSize: '11px', color: '#92400e', padding: '4px 8px', background: '#fef3c7', borderRadius: '6px' }
    }, `SDK update available: ${chimera.sdkUpdate.latest}`),
  );
}

// ─── Main export — ChimeraButton ───────────────────────────────────

/**
 * One-line Chimera integration.
 *
 * <ChimeraButton appDeveloperEVM="0x..." />
 *
 * Props:
 *   appDeveloperEVM — your EVM payout address (required)
 *   revenueSplit    — { machineOwner, appDeveloper } (default 70/30)
 *   onStatusChange  — callback(status) fired on every status update
 *
 * Self-contained: wraps itself in ChimeraWeb3AuthProvider if needed.
 * No external CSS, no wrapping, no hooks required.
 */
export function ChimeraButton({ appDeveloperEVM, revenueSplit, onStatusChange, chain = 'evm', mpcBaseUrl, children }) {
  // Check if we're already inside a Web3Auth provider by trying useChimera
  // If not, wrap ourselves in ChimeraWeb3AuthProvider

  return createElement(ChimeraWeb3AuthProvider, null,
    createElement(ChimeraButtonInner, {
      appDeveloperEVM,
      revenueSplit,
      onStatusChange,
      chain,
      mpcBaseUrl,
    }),
    children || null,
  );
}

export default ChimeraButton;
