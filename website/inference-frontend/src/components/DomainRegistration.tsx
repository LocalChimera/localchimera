import { useState } from 'react';
import { Search, Globe, CheckCircle, Loader2, ShoppingCart, Wallet } from 'lucide-react';
import { Button } from './ui';
import type { TxRecord } from '../types';

const PROXY_BASE = '/api/namesilo';

const SEARCH_TLDS = ['com', 'net', 'org', 'io', 'ai', 'co', 'dev', 'xyz', 'app', 'tech', 'cloud', 'online', 'store', 'site'];

interface DomainResult {
  domain: string;
  available: boolean;
  price?: string;
}

export default function DomainRegistration({
  evmAddress,
  onTx,
}: {
  evmAddress?: string;
  onTx?: (tx: TxRecord) => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [checking, setChecking] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [results, setResults] = useState<DomainResult[]>([]);
  const [error, setError] = useState('');
  const [selectedDomain, setSelectedDomain] = useState<DomainResult | null>(null);
  const [registering, setRegistering] = useState(false);
  const [success, setSuccess] = useState('');
  const [contact, setContact] = useState({ name: '', email: '', phone: '', address: '', city: '', state: '', country: 'US', postcode: '' });

  async function checkAvailability() {
    setError(''); setSuccess(''); setResults([]); setSelectedDomain(null); setHasSearched(false);
    const name = searchTerm.trim().toLowerCase().replace(/\s+/g, '');
    if (!name) { setError('Enter a domain name.'); return; }
    setChecking(true);
    try {
      const allDomains = SEARCH_TLDS.map(tld => `${name}.${tld}`);
      const res = await fetch(`${PROXY_BASE}/checkRegisterAvailability?domains=${allDomains.join(',')}`);
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Check failed'); setChecking(false); return; }
      const availRaw = data.result?.available ?? data.result?.body?.available;
      const availArr: any[] = availRaw ? (Array.isArray(availRaw) ? availRaw : [availRaw]) : [];
      const domainResults: DomainResult[] = allDomains.map(d => {
        const match = availArr.find((a: any) => {
          const ad = typeof a === 'string' ? a : (a && typeof a.domain === 'string' ? a.domain : null);
          return ad != null && String(ad).toLowerCase() === d.toLowerCase();
        });
        return {
          domain: d,
          available: !!match,
          price: (match && typeof match === 'object' && match.price != null) ? String(match.price) : undefined,
        };
      });
      setResults(domainResults.filter(r => r.available));
      setHasSearched(true);
    } catch (e: any) { setError(e.message || 'Failed to check'); }
    setChecking(false);
  }

  async function registerDomain(e: React.FormEvent) {
    e.preventDefault(); setError(''); setSuccess('');
    if (!selectedDomain || !selectedDomain.available) { setError('Select an available domain.'); return; }
    if (!evmAddress) { setError('Connect your wallet first.'); return; }
    for (const key of Object.keys(contact)) {
      if (!contact[key as keyof typeof contact]) { setError(`${key} is required.`); return; }
    }
    const priceUSD = parseFloat(selectedDomain.price || '10');
    const orderId = `DOMAIN:${selectedDomain.domain}:${Date.now()}`;
    setRegistering(true);
    const parts = contact.name.trim().split(/\s+/);
    try {
      const res = await fetch(`${PROXY_BASE}/registerDomain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: selectedDomain.domain, years: 1,
          walletAddress: evmAddress,
          paymentAmount: String(priceUSD),
          orderId,
          contact: {
            fn: parts[0] || contact.name, ln: parts.slice(1).join(' ') || parts[0] || '',
            email: contact.email, phone: contact.phone, ad: contact.address,
            city: contact.city, st: contact.state, country: contact.country, zp: contact.postcode,
          },
        }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (!data.success) { setError(data.error || 'Registration failed'); setRegistering(false); return; }
      setSuccess(`Registered ${selectedDomain.domain}. Order: ${data.result?.body?.order_id || 'N/A'}`);
      setSelectedDomain(null); setSearchTerm(''); setResults([]);
    } catch (e: any) { setError(e.message || 'Failed to register'); }
    setRegistering(false);
  }

  return (
    <div className="space-y-6 max-w-[720px]">
      <div className="bg-white rounded-2xl shadow-sm p-6 text-slate-800">
        <h2 className="text-xl font-bold text-slate-800 mb-2">Domain Registration</h2>
        <p className="text-sm text-slate-500 mb-4">Search for a domain name and we'll check availability across multiple TLDs (.com, .net, .org, .io, .ai, .co, .dev, .xyz, .app, .tech, .cloud, .online, .store, .site).</p>
      </div>
      <div className="bg-white rounded-2xl shadow-sm p-6 text-slate-800">
        <h3 className="font-semibold text-slate-800 mb-4">Search availability</h3>
        <div className="flex gap-2 mb-4">
          <div className="flex-1 flex items-center border border-[#e5e5e5] rounded-[10px] px-3">
            <Globe className="w-4 h-4 text-slate-400 mr-2" />
            <input
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value.replace(/\s+/g, '').toLowerCase()); setResults([]); setHasSearched(false); setError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); checkAvailability(); } }}
              placeholder="myapp"
              className="w-full py-2.5 text-[13px] outline-none bg-transparent"
            />
          </div>
          <Button onClick={checkAvailability} disabled={checking} className="bg-[#111111] text-white hover:opacity-85">
            {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          </Button>
        </div>
        {results.length > 0 && (
          <div className="space-y-1.5">
            {results.map((r) => (
              <div key={r.domain} className="flex items-center justify-between rounded-[10px] px-4 py-3 border border-green-200 bg-green-50">
                <div className="flex items-center gap-2">
                  <CheckCircle className="w-4 h-4 text-green-600" />
                  <span className="text-[13px] font-medium text-slate-800">{r.domain}</span>
                  {r.price && <span className="text-[12px] text-green-700 font-semibold">${r.price}</span>}
                </div>
                <button
                  onClick={() => setSelectedDomain(r)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-[12px] font-semibold transition ${selectedDomain?.domain === r.domain ? 'bg-[#111111] text-white' : 'border border-[#111111] text-[#111111] hover:bg-slate-100'}`}
                >
                  <ShoppingCart className="w-3.5 h-3.5" /> Register
                </button>
              </div>
            ))}
          </div>
        )}
        {!checking && hasSearched && results.length === 0 && (
          <p className="text-[13px] text-slate-500 text-center py-4">No domains available for "{searchTerm}". Try a different name.</p>
        )}
      </div>
      {selectedDomain && selectedDomain.available && (
        <form onSubmit={registerDomain} className="bg-white rounded-2xl shadow-sm p-6 text-slate-800 space-y-4">
          <h3 className="font-semibold text-slate-800 mb-2">Register {selectedDomain.domain}</h3>
          {selectedDomain.price && (
            <div className="flex items-center justify-between bg-slate-50 rounded-[10px] px-4 py-3">
              <span className="text-[13px] text-slate-600">Price</span>
              <span className="text-[15px] font-bold text-slate-800">${selectedDomain.price}/yr</span>
            </div>
          )}
          {['name', 'email', 'phone', 'address', 'city', 'state', 'postcode'].map((key) => (
            <div key={key}>
              <label className="block text-[12px] font-semibold text-slate-600 mb-1 capitalize">{key}</label>
              <input value={contact[key as keyof typeof contact]} onChange={(e) => setContact({ ...contact, [key]: e.target.value })} className="w-full px-3 py-2 rounded-[10px] border border-[#e5e5e5] text-[13px]" />
            </div>
          ))}
          <div>
            <label className="block text-[12px] font-semibold text-slate-600 mb-1">Country</label>
            <input value={contact.country} onChange={(e) => setContact({ ...contact, country: e.target.value })} className="w-full px-3 py-2 rounded-[10px] border border-[#e5e5e5] text-[13px]" />
          </div>
          <Button type="submit" disabled={registering} className="bg-[#111111] text-white hover:opacity-85">
            {registering ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null} Register {selectedDomain.domain}
          </Button>
        </form>
      )}
      {error && <p className="text-[13px] text-red-500">{error}</p>}
      {success && <div className="text-[13px] text-green-700 bg-green-50 rounded-[10px] p-3">{success}</div>}
    </div>
  );
}
