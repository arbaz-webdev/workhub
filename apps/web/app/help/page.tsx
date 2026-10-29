import type { Metadata } from 'next';
import { HelpSearch } from '@/components/help/help-search';
import { SiteFooter, SiteHeader } from '@/components/landing/site';

export const metadata: Metadata = {
  title: 'Help centre · WorkHub',
  description: 'How to set up WorkHub, check in, run projects and clients, chat, read reports, pay, and keep your account safe.',
};

export default function HelpPage() {
  return (
    <div className="min-h-screen bg-white">
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold tracking-tight">Help centre</h1>
        <p className="mt-2 text-gray-600">Short guides to everything in WorkHub. Can’t find it? Message us on WhatsApp.</p>
        <HelpSearch />
      </main>
      <SiteFooter />
    </div>
  );
}
