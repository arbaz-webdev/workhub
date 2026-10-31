import type { Role } from '@workhub/shared';

const press = 'transition duration-200 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50';

export const btn = {
  /** The main action: a black pill. */
  primary: `inline-flex items-center justify-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-black hover:shadow-md ${press}`,
  secondary: `inline-flex items-center justify-center gap-2 rounded-full border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-900 hover:border-gray-300 hover:bg-gray-50 ${press}`,
  /** A lime pill, for the one action that should stand out on a page. */
  accent: `inline-flex items-center justify-center gap-2 rounded-full bg-lime px-5 py-2.5 text-sm font-medium text-ink hover:brightness-95 ${press}`,
  ghost: `inline-flex items-center justify-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 hover:text-gray-900 ${press}`,
  danger: `inline-flex items-center justify-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 ${press}`,
  /** A round icon button; give it an aria-label. */
  icon: `inline-grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200 hover:text-gray-900 ${press}`,
};

export const input =
  'block w-full rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-sm outline-none transition placeholder:text-gray-400 hover:border-gray-300 focus:border-ink focus:ring-4 focus:ring-lime/40 disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500';

export function PageHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-normal tracking-tight text-ink sm:text-[34px] sm:leading-[1.15]">{title}</h1>
        {description && <p className="mt-2 max-w-2xl text-sm text-gray-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ title, description, children }: { title?: string; description?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl bg-white p-6 shadow-sm">
      {title && <h2 className="text-lg font-medium tracking-tight">{title}</h2>}
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      <div className={title || description ? 'mt-5' : ''}>{children}</div>
    </section>
  );
}

export function Alert({ kind = 'error', children }: { kind?: 'error' | 'success'; children: React.ReactNode }) {
  const cls = kind === 'error' ? 'bg-red-50 text-red-700' : 'bg-brand-50 text-brand-800';
  return (
    <p role={kind === 'error' ? 'alert' : 'status'} className={`animate-pop rounded-2xl px-4 py-2.5 text-sm ${cls}`}>
      {children}
    </p>
  );
}

/** A grey shape that shimmers while its content loads. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} />;
}

/** Placeholder for a page or panel that is loading: a few shimmering cards. */
export function Loading({ label = 'Loading', rows = 3 }: { label?: string; rows?: number }) {
  return (
    <div role="status" className="animate-fade space-y-3">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rounded-3xl bg-white p-5 shadow-sm">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="mt-3 h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
  guest: 'Guest',
};
export function roleLabel(role: Role) {
  return ROLE_LABELS[role];
}

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
export function timeAgo(iso: string): string {
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 60) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(seconds / 86400), 'day');
  return new Date(iso).toLocaleDateString();
}
