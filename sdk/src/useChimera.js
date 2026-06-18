/**
 * React hook for Chimera SDK integration.
 * Drop this into your React app to add mining controls.
 *
 * Usage:
 *   import { useChimera } from '@chimera/sdk/src/useChimera.js';
 *
 *   function MyApp() {
 *     const { status, start, stop, consentGiven, giveConsent } = useChimera({
 *       integratorWallet: '0x...',
 *       revenueSplit: { integrator: 0.30, machineOwner: 0.70 }
 *     });
 *
 *     return (
 *       <div>
 *         {!consentGiven && <button onClick={giveConsent}>Enable mining</button>}
 *         <button onClick={start} disabled={!consentGiven || status.running}>Start</button>
 *         <button onClick={stop} disabled={!status.running}>Stop</button>
 *         <pre>{JSON.stringify(status, null, 2)}</pre>
 *       </div>
 *     );
 *   }
 */

import { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = (typeof window !== 'undefined' &&
  (window.location.protocol === 'http:' || window.location.protocol === 'https:'))
  ? '/api' : 'http://localhost:3002/api';

export function useChimera(opts = {}) {
  const [status, setStatus] = useState({ running: false, miners: {}, consent: false });
  const [consentGiven, setConsentGiven] = useState(false);
  const intervalRef = useRef(null);

  const appDeveloperEVM = opts.appDeveloperEVM || null;
  const revenueSplit = opts.revenueSplit || { machineOwner: 0.70, appDeveloper: 0.30 };

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      const json = await res.json();
      if (json.success) {
        setStatus(prev => ({
          ...prev,
          running: json.data?.running || false,
          miners: json.data?.mining?.minerStatus || {}
        }));
      }
    } catch (e) { /* backend may not be running */ }
  }, []);

  useEffect(() => {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 5000);
    return () => clearInterval(intervalRef.current);
  }, [fetchStatus]);

  const giveConsent = useCallback(async () => {
    setConsentGiven(true);
    setStatus(prev => ({ ...prev, consent: true }));
    try {
      await fetch(`${API_BASE}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: true }) });
    } catch (e) {}
  }, []);

  const revokeConsent = useCallback(async () => {
    setConsentGiven(false);
    setStatus(prev => ({ ...prev, consent: false }));
    await stop();
    try {
      await fetch(`${API_BASE}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ consent: false }) });
    } catch (e) {}
  }, []);

  const start = useCallback(async () => {
    if (!consentGiven) return { success: false, error: 'Consent required' };
    try {
      const res = await fetch(`${API_BASE}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          machineOwnerEVM: opts.machineOwnerEVM || null,
          appDeveloperEVM,
          revenueSplit
        })
      });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      await fetchStatus();
      return json;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, [consentGiven, integratorWallet, revenueSplit, opts.machineOwnerWallet, fetchStatus]);

  const stop = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/stop`, { method: 'POST' });
      const text = await res.text();
      const json = text ? JSON.parse(text) : {};
      await fetchStatus();
      return json;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }, [fetchStatus]);

  return { status, consentGiven, giveConsent, revokeConsent, start, stop };
}
