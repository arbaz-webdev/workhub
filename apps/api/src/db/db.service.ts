import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { config } from '../config';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DbContext {
  /** Workspace the work belongs to. Row-Level Security limits tenant tables to it. */
  workspaceId?: string;
  /** Signed-in user. Lets a user read their own memberships across workspaces. */
  userId?: string;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: config.databaseAppUrl, max: 10 });
  /** Use only for global tables (users, sessions). Tenant data goes through withContext. */
  readonly db: Database = drizzle({ client: this.pool, schema });

  /**
   * Runs `fn` in a transaction whose Row-Level Security context is set to `ctx`.
   * The settings are transaction-local, so they can never leak to another request
   * that reuses the same pooled connection.
   */
  withContext<T>(ctx: DbContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select set_config('app.workspace_id', ${ctx.workspaceId ?? ''}, true),
                   set_config('app.user_id', ${ctx.userId ?? ''}, true)`,
      );
      return fn(tx);
    });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
