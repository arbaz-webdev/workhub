import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

/** Sign-in, sign-up and password pages: the form on the left, a lime panel on wide screens. */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="grid min-h-full gap-3 p-3 lg:grid-cols-[1fr_1.05fr]">
      <main className="flex flex-col px-3 py-6 sm:px-8">
        <Link href="/" className="flex w-fit items-center gap-2.5 text-lg font-medium tracking-tight text-ink">
          <span className="grid h-9 w-9 place-items-center rounded-[30%] bg-ink text-sm font-semibold text-lime">W</span>
          WorkHub
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <div className="animate-rise">
            <h1 className="text-4xl font-light tracking-tight text-ink">{title}</h1>
            <p className="mt-2 text-sm text-gray-500">{subtitle}</p>
          </div>
          {children && <div className="mt-8 animate-rise rounded-3xl bg-white p-6 shadow-sm [animation-delay:80ms]">{children}</div>}
          <p className="mt-6 animate-rise text-center text-sm text-gray-500 [animation-delay:160ms]">{footer}</p>
        </div>
      </main>

      <aside className="relative hidden overflow-hidden rounded-[2rem] bg-lime p-12 text-ink lg:flex lg:flex-col">
        <p className="text-sm font-medium">Attendance, projects, clients and chat</p>
        <p className="mt-auto max-w-md text-5xl font-light leading-[1.08] tracking-tight">Know who&apos;s working, on what, and which clients make you money.</p>
        <div className="mt-10 grid max-w-md grid-cols-2 gap-3" aria-label="Example figures">
          <div className="float rounded-3xl bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <p className="text-xs text-gray-500">In today</p>
              <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-gray-100">
                <ArrowUpRight size={14} strokeWidth={1.75} />
              </span>
            </div>
            <p className="mt-4 text-4xl font-light tracking-tight">
              18<span className="ml-1 text-sm text-gray-400">of 22</span>
            </p>
          </div>
          <div className="float rounded-3xl bg-ink p-5 text-white shadow-sm [animation-delay:-3.5s]">
            <div className="flex items-start justify-between">
              <p className="text-xs text-gray-400">Best client margin</p>
              <span aria-hidden="true" className="grid h-7 w-7 place-items-center rounded-full bg-lime text-ink">
                <ArrowUpRight size={14} strokeWidth={1.75} />
              </span>
            </div>
            <p className="mt-4 text-4xl font-light tracking-tight">46%</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-ink/60">Example figures</p>
        {/* Soft rings, echoing the reference's background circles */}
        <span aria-hidden="true" className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full border-[40px] border-white/25" />
      </aside>
    </div>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  error,
  hint,
  defaultValue,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
  defaultValue?: string;
}) {
  const describedBy = error ? `${name}-error` : hint ? `${name}-hint` : undefined;
  return (
    <label className="block">
      <span className="text-sm font-medium text-gray-700">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`mt-1.5 block w-full rounded-xl border bg-white px-3.5 py-2.5 text-sm outline-none transition focus:ring-4 ${
          error ? 'border-red-400 focus:ring-red-100' : 'border-gray-200 hover:border-gray-300 focus:border-ink focus:ring-lime/40'
        }`}
      />
      {error ? (
        <span id={`${name}-error`} className="mt-1 block text-xs text-red-600">
          {error}
        </span>
      ) : hint ? (
        <span id={`${name}-hint`} className="mt-1 block text-xs text-gray-500">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function SubmitButton({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex w-full items-center justify-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-black active:scale-[0.98] disabled:opacity-60"
    >
      {pending && <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
      {pending ? 'Please wait…' : children}
    </button>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="animate-pop rounded-2xl bg-red-50 px-4 py-2.5 text-sm text-red-700">
      {message}
    </p>
  );
}

/** Turns zod issues into { field: firstMessage }. */
export function issuesToFields(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of issues) out[String(issue.path[0])] ??= issue.message;
  return out;
}
