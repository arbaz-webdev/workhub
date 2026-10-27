'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** The CRM opens on its leads. */
export default function CrmPage() {
  const router = useRouter();
  useEffect(() => router.replace('/app/crm/leads'), [router]);
  return <p className="text-sm text-gray-500">Loading…</p>;
}
