import { cn } from '../lib/utils';

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}>{children}</div>;
}

export function Button({ children, onClick, disabled, variant = 'primary', className, type = 'button' }: any) {
  const variants: any = {
    primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/90',
    danger: 'bg-red-600 text-white hover:bg-red-700',
    outline: 'border bg-background hover:bg-accent hover:text-accent-foreground',
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled}
      className={cn('inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none disabled:opacity-50', variants[variant], className)}>
      {children}
    </button>
  );
}

export function Input({ label, value, onChange, placeholder, type = 'text' }: any) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
    </div>
  );
}

export function TextArea({ label, value, onChange, placeholder, rows = 3 }: any) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={rows}
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
    </div>
  );
}

export function Badge({ children, variant = 'default' }: any) {
  const variants: any = {
    default: 'bg-primary/10 text-[#00e5ff]',
    success: 'bg-[#22c55e]/10 text-[#4ade80]',
    error: 'bg-red-500/10 text-red-400',
    warning: 'bg-yellow-500/10 text-yellow-400',
  };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border border-white/5', variants[variant])}>{children}</span>;
}
