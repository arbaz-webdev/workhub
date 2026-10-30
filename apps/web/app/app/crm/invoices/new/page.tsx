'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { DocEditor } from '@/components/crm/client-docs';
import { CrmTabs, ManagersOnly } from '@/components/crm/shared';
import { PageHeader } from '@/components/ui';

export default function NewClientDocPage() {
  return (
    <ManagersOnly>
      <NewClientDoc />
    </ManagersOnly>
  );
}

function NewClientDoc() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = params.get('kind') === 'quote' ? 'quote' : 'invoice';
  return (
    <>
      <PageHeader title={kind === 'quote' ? 'New quote' : 'New invoice'} description="Saved as a draft. You can change it until you mark it sent." />
      <CrmTabs />
      <p className="mb-4 text-sm">
        <Link href="/app/crm/invoices" className="text-brand-700 underline">
          Back to quotes and invoices
        </Link>
      </p>
      <DocEditor kind={kind} companyId={params.get('company') ?? undefined} onSaved={(doc) => router.push(`/app/crm/invoices/${doc.id}`)} />
    </>
  );
}
