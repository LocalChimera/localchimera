import React, { useState, useEffect } from 'react';

const isNative = typeof window !== 'undefined' && (window.Capacitor || window.__TAURI__ || window.__bridgeFetch);
const NATIVE_API_BASE = typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE
  ? import.meta.env.VITE_API_BASE
  : 'http://localhost:3002/api';
const API_BASE = isNative
  ? NATIVE_API_BASE
  : (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    ? '/api'
    : NATIVE_API_BASE;

export default function AIWriter() {
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [docs, setDocs] = useState([]);
  const [status, setStatus] = useState(null);
  const [accessToken, setAccessToken] = useState(() => {
    try { return localStorage.getItem('chimera_access_token') || ''; } catch { return ''; }
  });
  const [accessSession, setAccessSession] = useState(() => {
    try { const s = localStorage.getItem('chimera_access_session'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [showAccessPanel, setShowAccessPanel] = useState(false);
  const [purchaseAmount, setPurchaseAmount] = useState('1.00');
  const [pricing, setPricing] = useState(null);
  const [purchasing, setPurchasing] = useState(false);
  const [accessError, setAccessError] = useState(null);

  useEffect(() => {
    fetchStatus();
    fetchDocs();
    fetchPricing();
  }, []);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/ai-status`);
      const json = await res.json();
      if (json.success) setStatus(json.data);
    } catch (e) {
      setStatus({ available: false, error: e.message });
    }
  };

  const fetchDocs = async () => {
    try {
      const res = await fetch(`${API_BASE}/ai-docs`);
      const json = await res.json();
      if (json.success) setDocs(json.data);
    } catch (e) {
      // ignore
    }
  };

  const fetchPricing = async () => {
    try {
      const res = await fetch(`${API_BASE}/inference-access/pricing`);
      const json = await res.json();
      if (json.success) setPricing(json.data);
    } catch (e) {
      // ignore
    }
  };

  const refreshAccessStatus = async () => {
    if (!accessSession?.sessionId) return;
    try {
      const res = await fetch(`${API_BASE}/inference-access/status?sessionId=${accessSession.sessionId}`);
      const json = await res.json();
      if (json.success) {
        setAccessSession(json.data);
        localStorage.setItem('chimera_access_session', JSON.stringify(json.data));
        if (json.data.credit <= 0 || !json.data.active) {
          setAccessToken('');
          localStorage.removeItem('chimera_access_token');
        }
      }
    } catch (e) {
      // ignore
    }
  };

  const handlePurchase = async () => {
    const amt = parseFloat(purchaseAmount);
    if (!amt || amt <= 0) { setAccessError('Enter a valid amount'); return; }
    setPurchasing(true);
    setAccessError(null);
    try {
      const res = await fetch(`${API_BASE}/inference-access/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amountUSDT: amt }),
      });
      const json = await res.json();
      if (json.success) {
        const data = json.data;
        setAccessToken(data.token);
        localStorage.setItem('chimera_access_token', data.token);
        const sessionInfo = {
          sessionId: data.sessionId,
          credit: data.credit,
          pricePerToken: data.pricePerToken,
          expiresAt: data.expiresAt,
          active: true,
        };
        setAccessSession(sessionInfo);
        localStorage.setItem('chimera_access_session', JSON.stringify(sessionInfo));
      } else {
        setAccessError(json.error || 'Purchase failed');
      }
    } catch (e) {
      setAccessError(e.message);
    } finally {
      setPurchasing(false);
    }
  };

  const clearAccess = () => {
    setAccessToken('');
    setAccessSession(null);
    try { localStorage.removeItem('chimera_access_token'); localStorage.removeItem('chimera_access_session'); } catch {}
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch(`${API_BASE}/ai-write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(accessToken ? { 'Authorization': `Bearer ${accessToken}` } : {}) },
        body: JSON.stringify({ prompt, title })
      });
      const json = await res.json();
      if (json.success) {
        setResult(json.data);
        fetchDocs();
      } else {
        setError(json.error || 'Generation failed');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const statusBadge = () => {
    if (!status) return <span style={styles.badgeGray}>Checking...</span>;
    if (status.qvacAvailable) return <span style={styles.badgeGreen}>QVAC ({status.model})</span>;
    return <span style={styles.badgeOrange}>Demo Mode</span>;
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.heading}>AI Writer</h1>
      <p style={styles.sub}>Local AI running in QVAC. Generated docs are stored in Hypercore and synced via Pear P2P.</p>

      <div style={styles.statusBar}>
        <span style={styles.statusLabel}>Backend:</span>
        {statusBadge()}
        {accessToken && accessSession?.active && (
          <span style={styles.badgeBlue}>Access: {accessSession.credit?.toLocaleString()} credits left</span>
        )}
        <button style={styles.refreshBtn} onClick={() => { fetchStatus(); refreshAccessStatus(); }} disabled={loading}>Refresh</button>
      </div>

      <div style={{ marginBottom: 16 }}>
        <button style={styles.toggleKeyBtn} onClick={() => setShowAccessPanel(s => !s)}>
          {showAccessPanel ? '▾' : '▸'} Inference Access (Pay-per-use)
        </button>
        {showAccessPanel && (
          <div style={styles.keyPanel}>
            {accessSession?.active && accessToken ? (
              <div>
                <p style={styles.keyHint}>You have an active access session. Credits are deducted per inference request.</p>
                <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
                  <div><span style={styles.label}>Session</span><br/><span style={{ color: '#e2e2e2', fontSize: 13 }}>{accessSession.sessionId?.slice(0, 16)}...</span></div>
                  <div><span style={styles.label}>Credits</span><br/><span style={{ color: '#86efac', fontSize: 14, fontWeight: 600 }}>{accessSession.credit?.toLocaleString()}</span></div>
                  <div><span style={styles.label}>Price/token</span><br/><span style={{ color: '#e2e2e2', fontSize: 13 }}>{accessSession.pricePerToken?.toFixed(6)} USDT</span></div>
                  <div><span style={styles.label}>Expires</span><br/><span style={{ color: '#e2e2e2', fontSize: 13 }}>{accessSession.expiresAt ? new Date(accessSession.expiresAt).toLocaleTimeString() : '-'}</span></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button style={styles.btn} onClick={refreshAccessStatus}>Refresh Status</button>
                  <button style={{ ...styles.btn, background: '#7f1d1d' }} onClick={clearAccess}>Clear Session</button>
                </div>
              </div>
            ) : (
              <div>
                <p style={styles.keyHint}>Purchase inference credits to use AI Writer. You pay USDT and receive a session token with token credits. No API key sharing — your access is private and temporary.</p>
                {pricing && (
                  <div style={{ marginBottom: 12, padding: '8px 12px', background: '#12121c', borderRadius: 6, border: '1px solid #1e1e2e' }}>
                    <span style={{ color: '#94a3b8', fontSize: 12 }}>Current price: </span>
                    <span style={{ color: '#93c5fd', fontSize: 13, fontWeight: 600 }}>{pricing.pricePer1kTokens} USDT / 1k tokens</span>
                  </div>
                )}
                <div style={styles.field}>
                  <label style={styles.label}>Amount (USDT)</label>
                  <input style={styles.input} value={purchaseAmount} onChange={e => setPurchaseAmount(e.target.value)} placeholder="1.00" disabled={purchasing} />
                </div>
                {accessError && <div style={{ color: '#fca5a5', fontSize: 12, marginBottom: 8 }}>{accessError}</div>}
                <button style={styles.btn} onClick={handlePurchase} disabled={purchasing}>
                  {purchasing ? 'Processing...' : 'Purchase Credits'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} style={styles.form}>
        <div style={styles.field}>
          <label style={styles.label}>Title (optional)</label>
          <input
            style={styles.input}
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Auto-generated from prompt"
            disabled={loading}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Prompt / Topic</label>
          <textarea
            style={styles.textarea}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            placeholder="Write a comprehensive guide on Python decorators..."
            rows={4}
            required
            disabled={loading}
          />
        </div>
        <button type="submit" style={styles.btn} disabled={loading}>
          {loading ? 'Generating...' : 'Generate & Save'}
        </button>
      </form>

      {error && <div style={styles.error}>{error}</div>}

      {result && (
        <div style={styles.result}>
          <h2 style={styles.resultTitle}>{result.title}</h2>
          <div style={styles.meta}>Source: {result.source} | Model: {result.model}</div>
          <pre style={styles.body}>{result.body}</pre>
        </div>
      )}

      {docs.length > 0 && (
        <div style={styles.docs}>
          <h2 style={styles.docsTitle}>Generated Docs ({docs.length})</h2>
          <ul style={styles.docList}>
            {docs.map(d => (
              <li key={d.id} style={styles.docItem}>
                <strong>{d.title}</strong>
                <span style={styles.docDate}>{new Date(d.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const styles = {
  container: { maxWidth: 800, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' },
  heading: { fontSize: 28, marginBottom: 8, color: '#f8fafc' },
  sub: { color: '#94a3b8', marginBottom: 20, fontSize: 14 },
  statusBar: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '10px 14px', background: '#12121c', borderRadius: 6, border: '1px solid #1e1e2e' },
  statusLabel: { color: '#64748b', fontSize: 13 },
  badgeGreen: { background: '#166534', color: '#86efac', padding: '3px 10px', borderRadius: 4, fontSize: 12 },
  badgeBlue: { background: '#1e3a8a', color: '#93c5fd', padding: '3px 10px', borderRadius: 4, fontSize: 12 },
  toggleKeyBtn: { background: 'none', border: '1px solid #1e1e2e', color: '#94a3b8', padding: '6px 12px', borderRadius: 6, fontSize: 12, cursor: 'pointer', width: '100%', textAlign: 'left' },
  keyPanel: { marginTop: 8, padding: 16, background: '#0a0a14', border: '1px solid #1e1e2e', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 12 },
  keyHint: { color: '#94a3b8', fontSize: 12, margin: '0 0 4px', lineHeight: 1.5 },
  badgeOrange: { background: '#7c2d12', color: '#fdba74', padding: '3px 10px', borderRadius: 4, fontSize: 12 },
  badgeGray: { background: '#374151', color: '#d1d5db', padding: '3px 10px', borderRadius: 4, fontSize: 12 },
  refreshBtn: { marginLeft: 'auto', background: '#1e1e2e', color: '#94a3b8', border: '1px solid #2e2e3e', padding: '4px 10px', borderRadius: 4, fontSize: 12, cursor: 'pointer' },
  form: { display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 12, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: 600 },
  input: { background: '#0a0a14', border: '1px solid #1e1e2e', borderRadius: 6, padding: '10px 12px', color: '#e2e2e2', fontSize: 14 },
  textarea: { background: '#0a0a14', border: '1px solid #1e1e2e', borderRadius: 6, padding: '10px 12px', color: '#e2e2e2', fontSize: 14, resize: 'vertical' },
  btn: { background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 18px', borderRadius: 6, fontSize: 14, cursor: 'pointer', alignSelf: 'flex-start' },
  error: { background: '#7f1d1d', color: '#fecaca', padding: 12, borderRadius: 6, marginTop: 16 },
  result: { marginTop: 20, background: '#12121c', border: '1px solid #1e1e2e', borderRadius: 8, padding: 20 },
  resultTitle: { margin: '0 0 8px', fontSize: 20, color: '#f8fafc' },
  meta: { color: '#64748b', fontSize: 12, marginBottom: 12 },
  body: { background: '#0a0a14', padding: 16, borderRadius: 6, overflow: 'auto', fontSize: 14, lineHeight: 1.7, color: '#e2e2e2', whiteSpace: 'pre-wrap', wordWrap: 'break-word', border: '1px solid #1e1e2e' },
  docs: { marginTop: 24 },
  docsTitle: { fontSize: 18, marginBottom: 12, color: '#f8fafc' },
  docList: { listStyle: 'none', padding: 0, margin: 0 },
  docItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 12px', background: '#12121c', border: '1px solid #1e1e2e', borderRadius: 6, marginBottom: 8, color: '#e2e2e2' },
  docDate: { color: '#64748b', fontSize: 12 }
};
