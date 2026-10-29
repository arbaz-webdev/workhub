import Link from 'next/link';

export function Logo() {
  return (
    <span className="flex items-center gap-2 text-lg font-semibold text-gray-900">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">W</span>
      WorkHub
    </span>
  );
}

const LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/help', label: 'Help' },
];

/** The public site's top bar (home, pricing, help centre, status). */
export function SiteHeader({ cta = { href: '/#beta', label: 'Join the beta' } }: { cta?: { href: string; label: string } }) {
  return (
    <header className="sticky top-0 z-10 border-b border-gray-100 bg-white/90 backdrop-blur">
      <nav aria-label="Site" className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" aria-label="WorkHub home">
          <Logo />
        </Link>
        <div className="ms-auto hidden items-center gap-6 text-sm text-gray-600 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-gray-900">
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ms-auto flex items-center gap-2 md:ms-0">
          <Link href="/sign-in" className="rounded-lg px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
            Sign in
          </Link>
          <Link href={cta.href} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">
            {cta.label}
          </Link>
        </div>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-100">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-8 text-sm text-gray-500">
        <Logo />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/pricing" className="hover:text-gray-800">
            Pricing
          </Link>
          <Link href="/help" className="hover:text-gray-800">
            Help centre
          </Link>
          <Link href="/status" className="hover:text-gray-800">
            Status
          </Link>
          <Link href="/sign-in" className="hover:text-gray-800">
            Sign in
          </Link>
        </nav>
        <p>© {new Date().getFullYear()} WorkHub · Made in Pakistan</p>
      </div>
    </footer>
  );
}
