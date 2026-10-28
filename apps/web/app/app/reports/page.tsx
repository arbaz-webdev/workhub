'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { firstReport } from '@/components/reports/shared';
import { useWorkspace } from '@/lib/workspace';

/** Reports open on the first one this person may see. */
export default function ReportsPage() {
  const router = useRouter();
  const { workspace } = useWorkspace();
  useEffect(() => router.replace(firstReport(workspace.role)), [router, workspace.role]);
  return <p className="text-sm text-gray-500">Loading…</p>;
}
