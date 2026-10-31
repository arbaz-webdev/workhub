import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/landing/site';
import { StatusBoard } from './status-board';

export const metadata: Metadata = {
  title: 'WorkHub status',
  description: 'Whether WorkHub is working right now, uptime over the last 90 days, and any incidents.',
};

export default function StatusPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="mx-auto max-w-3xl animate-rise px-4 py-12">
        <h1 className="text-4xl font-light tracking-tight">WorkHub status</h1>
        <StatusBoard />
      </main>
      <SiteFooter />
    </div>
  );
}
