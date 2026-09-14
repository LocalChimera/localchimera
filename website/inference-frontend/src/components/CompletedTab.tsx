import { useState, useEffect, useCallback } from 'react';
import { Card, Badge } from './ui';
import { RefreshCw, Brain, HardDrive, Cpu, Wifi, CheckCircle } from 'lucide-react';

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

export default function CompletedTab() {
  const [loading, setLoading] = useState(false);
  const [tasks, setTasks] = useState<CompletedTask[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/market/completed');
      const data = await res.json().catch(() => ({}));
      const all: CompletedTask[] = (data.tasks || []).map((t: any) => ({
        id: t.id,
        market: t.market || 'Inference',
        marketIcon: t.marketIcon || 'brain',
        amount: t.amount || 0,
        status: t.status || 'completed',
        details: t.details || '',
      }));
      all.sort((a, b) => b.amount - a.amount);
      setTasks(all);
    } catch (e) {
      console.error('Failed to load completed tasks:', e);
    } finally {
      setLoading(false);
    }
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
                  {t.amount > 0 && <span className="font-semibold text-green-400">{t.amount.toFixed(4)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
