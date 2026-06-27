import { useState, useEffect, useCallback } from 'react';
import { Card, Badge } from './ui';
import { RefreshCw, Brain, HardDrive, Cpu, Wifi, CheckCircle } from 'lucide-react';
import { CONTRACTS, getContractNamedKeys, queryDictionary } from '../casper-client';

interface CompletedTask {
  id: string;
  market: string;
  marketIcon: string;
  amount: number;
  status: string;
  details: string;
}

const JOB_STATUS: Record<string, string> = {
  '0': 'pending', '1': 'assigned', '2': 'provider_done', '3': 'confirmed',
  '4': 'paid', '5': 'refunded', '6': 'disputed', '7': 'resolved',
};

const AGREEMENT_STATUS: Record<string, string> = {
  '0': 'pending', '1': 'approved', '2': 'rejected', '3': 'active', '4': 'terminated',
};

const SESSION_STATUS: Record<string, string> = {
  '0': 'pending', '1': 'confirmed', '2': 'closed', '3': 'disputed', '4': 'resolved',
};

export default function CompletedTab() {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<CompletedTask[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    const all: CompletedTask[] = [];

    try {
      // Inference — completed, confirmed, paid, resolved, refunded
      const imKeys = await getContractNamedKeys(CONTRACTS.inferenceMarket);
      const jobsUref = imKeys['jobs_dict'];
      const pendingUref = imKeys['pending_jobs'];
      if (jobsUref && pendingUref) {
        const pendingList = await queryDictionary(pendingUref, 'list');
        const jobIds: string[] = Array.isArray(pendingList) ? pendingList as string[] : [];
        for (const id of jobIds) {
          const state = await queryDictionary(jobsUref, `${id}:state`);
          if (state === null || state === undefined) continue;
          const stateNum = Number(state);
          // Show jobs that are provider_done (2) or beyond
          if (stateNum < 2) continue;
          const statusStr = JOB_STATUS[String(stateNum)] || String(stateNum);
          const amount = Number(await queryDictionary(jobsUref, `${id}:amount`) || '0');
          all.push({ id, market: 'Inference', marketIcon: 'brain', amount, status: statusStr, details: `${id.slice(0, 30)}...` });
        }
      }

      // Storage — confirmed files
      const smKeys = await getContractNamedKeys(CONTRACTS.storageMarket);
      const filesUref = smKeys['sm_files'];
      if (filesUref) {
        for (let i = 0; i < 20; i++) {
          const id = `file-${i}`;
          const status = await queryDictionary(filesUref, `${id}:status`);
          if (status === null || status === undefined) continue;
          if (String(status) !== '1') continue;
          const sizeMb = String(await queryDictionary(filesUref, `${id}:size`) || '0');
          const fileHash = String(await queryDictionary(filesUref, `${id}:hash`) || '');
          all.push({ id, market: 'Storage', marketIcon: 'harddrive', amount: 0, status: 'confirmed', details: `${sizeMb} MB · ${fileHash.slice(0, 16)}...` });
        }
      }

      // Compute — terminated agreements
      const cmKeys = await getContractNamedKeys(CONTRACTS.computeMarket);
      const agreementsUref = cmKeys['cm_agreements'];
      if (agreementsUref) {
        for (let i = 0; i < 20; i++) {
          const id = `agreement-${i}`;
          const status = await queryDictionary(agreementsUref, `${id}:status`);
          if (status === null || status === undefined) continue;
          const statusStr = AGREEMENT_STATUS[String(status)] || String(status);
          if (!['terminated'].includes(statusStr)) continue;
          const amount = Number(await queryDictionary(agreementsUref, `${id}:amount`) || '0');
          const demandId = String(await queryDictionary(agreementsUref, `${id}:demand`) || '');
          all.push({ id, market: 'Compute', marketIcon: 'cpu', amount, status: statusStr, details: `Demand: ${demandId}` });
        }
      }

      // Bandwidth — closed/resolved sessions
      const bmKeys = await getContractNamedKeys(CONTRACTS.bandwidthMarket);
      const sessionsUref = bmKeys['bm_sessions'];
      if (sessionsUref) {
        for (let i = 0; i < 20; i++) {
          const id = `session-${i}`;
          const status = await queryDictionary(sessionsUref, `${id}:status`);
          if (status === null || status === undefined) continue;
          const statusStr = SESSION_STATUS[String(status)] || String(status);
          if (!['closed', 'resolved'].includes(statusStr)) continue;
          const amount = Number(await queryDictionary(sessionsUref, `${id}:amount`) || '0');
          const maxDuration = String(await queryDictionary(sessionsUref, `${id}:max_duration`) || '0');
          const maxData = String(await queryDictionary(sessionsUref, `${id}:max_data`) || '0');
          all.push({ id, market: 'Bandwidth', marketIcon: 'wifi', amount, status: statusStr, details: `${maxDuration}s · ${maxData} MB` });
        }
      }
    } catch (e) {
      console.error('Failed to load completed tasks:', e);
    } finally {
      setLoading(false);
    }

    all.sort((a, b) => b.amount - a.amount);
    setTasks(all);
  }, []);

  useEffect(() => {
    loadData();
    const id = setInterval(loadData, 30000);
    return () => clearInterval(id);
  }, [loadData]);

  const iconFor = (icon: string) => {
    const cls = 'h-4 w-4';
    if (icon === 'brain') return <Brain className={cls} />;
    if (icon === 'harddrive') return <HardDrive className={cls} />;
    if (icon === 'cpu') return <Cpu className={cls} />;
    if (icon === 'wifi') return <Wifi className={cls} />;
    return null;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2"><CheckCircle className="h-6 w-6 text-green-400" />Completed Tasks</h2>
          <p className="text-muted-foreground text-sm">All completed tasks across every market.</p>
        </div>
        <button onClick={loadData} disabled={loading} className="text-xs flex items-center gap-1 text-blue-600 hover:underline">
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <Card className="p-4">
        {tasks.length === 0 ? (
          <p className="text-xs text-muted-foreground">No completed tasks yet.</p>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto">
            {tasks.map((t) => (
              <div key={`${t.market}-${t.id}`} className="flex items-center justify-between text-xs bg-muted p-3 rounded-lg">
                <div className="flex items-center gap-3">
                  <span className="text-green-400">{iconFor(t.marketIcon)}</span>
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{t.market}</Badge>
                      <span className="font-mono text-[#7a7468]">{t.id}</span>
                    </div>
                    <div className="text-[#7a7468] mt-0.5">{t.details}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge variant="success">{t.status}</Badge>
                  {t.amount > 0 && <span className="font-semibold text-green-400">{(t.amount / 1e9).toFixed(4)} CSPR</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
