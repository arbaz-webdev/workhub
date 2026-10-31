'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { firstReport } from '@/components/reports/shared';
import { useWorkspace } from '@/lib/workspace';
import { Loading } from '@/components/ui';

/** Reports open on the first one this person may see. */
export default function ReportsPage() {
  const router = useRouter();
  const { workspace } = useWorkspace();
  useEffect(() => router.replace(firstReport(workspace.role)), [router, workspace.role]);
  return <Loading />;
}
