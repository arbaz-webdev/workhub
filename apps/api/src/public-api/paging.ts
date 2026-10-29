import { BadRequestException } from '@nestjs/common';
import { asc, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';

// Lists come oldest first, a page at a time. The cursor is opaque to callers: it holds the
// last row's creation time and id, so pages stay stable while new rows are added.

export const MAX_PAGE = 100;

export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-01-31');

export const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE).default(50),
  cursor: z.string().max(200).optional(),
});

/** For lists that can be synced: only rows created or changed at or after this time. */
export const updatedSince = z.iso.datetime({ offset: true }).optional();

export interface Page<T> {
  data: T[];
  /** Pass as ?cursor= for the next page; null on the last one. */
  nextCursor: string | null;
}

export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: string; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!at || !id || Number.isNaN(Date.parse(at)) || !/^[0-9a-f-]{36}$/.test(id)) throw new BadRequestException('Invalid cursor');
  return { at, id };
}

/**
 * Where-clause and order for one page of a table, by (created at, id). Postgres keeps
 * microseconds but the cursor (a JavaScript date) only milliseconds, so both sides compare
 * at millisecond precision; otherwise a row could repeat on the next page.
 */
export function keyset(createdAt: PgColumn, id: PgColumn, cursor: string | undefined): { after: SQL | undefined; order: SQL[] } {
  const c = cursor ? decodeCursor(cursor) : null;
  const at = sql`date_trunc('milliseconds', ${createdAt})`;
  return {
    after: c ? sql`(${at}, ${id}) > (${c.at}::timestamptz, ${c.id}::uuid)` : undefined,
    order: [asc(at), asc(id)],
  };
}

/** Rows fetched with limit + 1, trimmed to a page. */
export function toPage<R extends { createdAt: Date; id: string }, T>(rows: R[], limit: number, map: (row: R) => T): Page<T> {
  const more = rows.length > limit;
  const shown = more ? rows.slice(0, limit) : rows;
  const last = shown.at(-1);
  return { data: shown.map(map), nextCursor: more && last ? encodeCursor(last.createdAt, last.id) : null };
}

export const iso = (d: Date | null) => d?.toISOString() ?? null;
