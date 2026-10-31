'use client';

import type { ClientDocumentDto } from '@workhub/shared';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { DocPaper } from '@/components/crm/client-docs';
import { errorText } from '@/components/crm/shared';
import { Alert, btn, Loading } from '@/components/ui';
import { useWorkspaceApi } from '@/lib/workspace';

/** A quote or invoice, as its client sees it. */
export default function PortalDocPage() {
  const { id } = useParams<{ id: string }>();
  const preview = useSearchParams().get('company');
  const api = useWorkspaceApi();
  const [doc, setDoc] = useState<ClientDocumentDto>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    api<ClientDocumentDto>(`/portal/docs/${id}${preview ? `?companyId=${encodeURIComponent(preview)}` : ''}`)
      .then(setDoc)
      .catch((err) => setError(errorText(err, 'Could not load it.')));
  }, [api, id, preview]);

  if (error) return <Alert>{error}</Alert>;
  if (!doc) return <Loading />;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`/app/portal${preview ? `?company=${preview}` : ''}`} className="text-sm text-brand-700 underline">
          Back to the portal
        </Link>
        <button type="button" className={`${btn.secondary} ml-auto`} onClick={() => window.print()}>
          Print or save PDF
        </button>
      </div>
      <DocPaper doc={doc} />
    </>
  );
}
