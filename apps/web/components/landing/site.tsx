import Link from 'next/link';

/** The mark and name; `compact` hides the name on narrow phones (the link keeps its label). */
export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 text-lg font-medium tracking-tight text-ink">
      <span className="grid h-9 w-9 place-items-center rounded-[30%] bg-ink text-sm font-semibold text-lime">W</span>
      <span className={compact ? 'max-[400px]:hidden' : undefined}>WorkHub</span>
    </span>
  );
}

const LINKS = [
  { href: '/#features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/help', label: 'Help' },
];

/** The public site's top bar (home, pricing, help centre, status): a white pill floating over the page. */
export function SiteHeader({ cta = { href: '/#beta', label: 'Join the beta' } }: { cta?: { href: string; label: string } }) {
  return (
    <header className="sticky top-0 z-20 px-4 pt-4">
      <nav aria-label="Site" className="mx-auto flex max-w-6xl items-center gap-4 rounded-full bg-white/85 py-2 pl-3 pr-2 shadow-sm backdrop-blur-md">
        <Link href="/" aria-label="WorkHub home">
          <Logo compact />
        </Link>
        <div className="mx-auto hidden items-center gap-1 text-sm md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full px-4 py-2 text-gray-600 transition hover:bg-gray-100 hover:text-ink">
              {l.label}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5 md:ml-0">
          <Link href="/sign-in" className="whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-100 sm:px-4">
            Sign in
          </Link>
          <Link href={cta.href} className="whitespace-nowrap rounded-full bg-ink px-4 py-2 text-sm font-medium text-white transition hover:bg-black active:scale-[0.97] sm:px-5">
            {cta.label}
          </Link>
        </div>
      </nav>
    </header>
  );
}

const FOOTER_LINKS = [
  { href: '/pricing', label: 'Pricing' },
  { href: '/help', label: 'Help centre' },
  { href: '/status', label: 'Status' },
  { href: '/developers', label: 'API' },
  { href: '/sign-in', label: 'Sign in' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
];

export function SiteFooter() {
  return (
    <footer className="px-4 pb-4">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 rounded-[2rem] bg-white px-6 py-8 text-sm text-gray-500 shadow-sm sm:px-8">
        <Logo />
        <nav aria-label="Footer" className="flex flex-wrap gap-x-1 gap-y-1">
          {FOOTER_LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="rounded-full px-3 py-1.5 transition hover:bg-gray-100 hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
        <p>© {new Date().getFullYear()} WorkHub · Made in Pakistan</p>
      </div>
    </footer>
  );
}
