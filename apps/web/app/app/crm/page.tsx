'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loading } from '@/components/ui';

/** The CRM opens on the deals board. */
export default function CrmPage() {
  const router = useRouter();
  useEffect(() => router.replace('/app/crm/deals'), [router]);
  return <Loading />;
}
