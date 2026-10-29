'use client';

import type { PortalDto } from '@workhub/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorText } from '@/components/crm/shared';
import { PortalView } from '@/components/crm/portal-view';
import { Alert, PageHeader } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

/** The client portal: a client contact's own, or a manager's preview with ?company=. */
export default function PortalPage() {
  const api = useWorkspaceApi();
  const preview = useSearchParams().get('company');
  const [portal, setPortal] = useState<PortalDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<PortalDto>(preview ? `/portal?companyId=${encodeURIComponent(preview)}` : '/portal')
      .then(setPortal)
      .catch((err) => setError(errorText(err, 'Could not load the portal.')));
  }, [api, preview]);

  if (error) return <Alert>{error}</Alert>;
  if (!portal) return <p className="text-sm text-gray-500">Loading…</p>;
  return (
    <>
      {preview && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          Preview: this is what contacts at {portal.company.name} see.{' '}
          <Link href={`/app/crm/companies/${preview}`} className="underline">
            Back to {portal.company.name}
          </Link>
        </p>
      )}
      <PageHeader title={portal.company.name} description={`Your projects with ${portal.workspaceName}: progress, hours worked, quotes and invoices.`} />
      <PortalView portal={portal} docHref={(id) => `/app/portal/docs/${id}${preview ? `?company=${preview}` : ''}`} />
    </>
  );
}
