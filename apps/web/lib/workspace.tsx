'use client';

import type { MeResponse, WorkspaceDto } from '@workhub/shared';
import { createContext, useCallback, useContext } from 'react';
import { api } from './api';

const WORKSPACE_KEY = 'wh_workspace';

export function readStoredWorkspace(): string | null {
  try {
    return localStorage.getItem(WORKSPACE_KEY);
  } catch {
    return null;
  }
}

export function storeWorkspace(id: string) {
  try {
    localStorage.setItem(WORKSPACE_KEY, id);
  } catch {
    // Storage can be unavailable (private mode); the choice still applies for this visit.
  }
}

export interface WorkspaceContextValue {
  me: MeResponse;
  workspace: WorkspaceDto;
  switchTo: (workspace: WorkspaceDto) => void;
  /** Reloads the user and their workspaces (after joining, renaming, role changes…). */
  refresh: () => Promise<void>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('useWorkspace must be used inside the app shell');
  return value;
}

/** `api` bound to the current workspace. */
export function useWorkspaceApi() {
  const { workspace } = useWorkspace();
  return useCallback(
    <T,>(path: string, options: Omit<Parameters<typeof api>[1] & object, 'workspaceId'> = {}) =>
      api<T>(path, { ...options, workspaceId: workspace.id }),
    [workspace.id],
  );
}

/** Only allow same-site relative paths as a post-login destination (no open redirects). */
export function safeNext(next: string | null | undefined): string | undefined {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return undefined;
  return next;
}
