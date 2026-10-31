'use client';

import type { PortalDto } from '@workhub/shared';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { errorText } from '@/components/crm/shared';
import { PortalView } from '@/components/crm/portal-view';
import { Alert, PageHeader, Loading } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

/** The client portal: a client contact's own, or a manager's preview with ?company=. */
export default function PortalPage() {
  const api = useWorkspaceApi();
  const { workspace } = useWorkspace();
  const preview = useSearchParams().get('company');
  // Staff have no portal of their own: they preview a client's from the client's page.
  const staffWithoutClient = workspace.role !== 'guest' && !preview;
  const [portal, setPortal] = useState<PortalDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (staffWithoutClient) return;
    api<PortalDto>(preview ? `/portal?companyId=${encodeURIComponent(preview)}` : '/portal')
      .then(setPortal)
      .catch((err) => setError(errorText(err, 'Could not load the portal.')));
  }, [api, preview, staffWithoutClient]);

  if (staffWithoutClient) {
    return (
      <>
        <PageHeader title="Client portal" description="What a client's contacts see when they sign in: their projects, hours, quotes and invoices." />
        <p className="text-sm text-gray-600">
          To preview a client&apos;s portal, open the client in{' '}
          <Link href="/app/crm/companies" className="text-brand-700 underline">
            CRM → Companies
          </Link>{' '}
          and choose <strong>Preview</strong>.
        </p>
      </>
    );
  }
  if (error) return <Alert>{error}</Alert>;
  if (!portal) return <Loading />;
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
