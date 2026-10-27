'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** The CRM opens on the deals board. */
export default function CrmPage() {
  const router = useRouter();
  useEffect(() => router.replace('/app/crm/deals'), [router]);
  return <p className="text-sm text-gray-500">Loading…</p>;
}
