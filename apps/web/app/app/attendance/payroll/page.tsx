'use client';

import { hasRole, type MemberCodesDto, type PayrollTemplateDto } from '@workhub/shared';
import { useCallback, useEffect, useState } from 'react';
import { DeviceImport, MemberCodes, PayrollExport, PayrollTemplates } from '@/components/attendance/payroll';
import { AttendanceTabs } from '@/components/attendance/tabs';
import { Alert, PageHeader } from '@/components/ui';
import { useWorkspace, useWorkspaceApi } from '@/lib/workspace';

/** Payroll exports (managers) and, for admins, layouts, employee codes and the device import. */
export default function PayrollPage() {
  const api = useWorkspaceApi();
  const { workspace } = useWorkspace();
  const manager = hasRole(workspace.role, 'manager');
  const admin = hasRole(workspace.role, 'admin');
  const [templates, setTemplates] = useState<PayrollTemplateDto[]>();
  const [codes, setCodes] = useState<MemberCodesDto[]>([]);
  const [error, setError] = useState<string>();

  const loadTemplates = useCallback(() => {
    if (!manager) return;
    api<PayrollTemplateDto[]>('/attendance/payroll/templates')
      .then(setTemplates)
      .catch(() => setError('Could not load the export layouts.'));
  }, [api, manager]);
  const loadCodes = useCallback(() => {
    if (!admin) return;
    api<MemberCodesDto[]>('/attendance/payroll/codes')
      .then(setCodes)
      .catch(() => setError('Could not load employee codes.'));
  }, [api, admin]);
  useEffect(loadTemplates, [loadTemplates]);
  useEffect(loadCodes, [loadCodes]);

  if (!manager) {
    return (
      <>
        <PageHeader title="Attendance" />
        <AttendanceTabs />
        <Alert>Only managers can export attendance for payroll.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Attendance" description="Export the month for payroll, and bring in attendance from fingerprint devices." />
      <AttendanceTabs />
      {error && <Alert>{error}</Alert>}
      {!templates ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : (
        <div className="space-y-6">
          <PayrollExport templates={templates} />
          {admin && (
            <>
              <DeviceImport codes={codes} onImported={loadCodes} />
              <PayrollTemplates templates={templates} onChanged={loadTemplates} />
              <MemberCodes codes={codes} onChanged={setCodes} />
            </>
          )}
        </div>
      )}
    </>
  );
}
