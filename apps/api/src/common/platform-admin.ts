import { ForbiddenException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import type { DbService } from '../db/db.service';
import { users } from '../db/schema';
import type { AuthContext } from './request';

/** WorkHub's own staff: PLATFORM_ADMINS, with a verified email. Returns the email, or throws 403. */
export async function platformAdmin(db: DbService, auth: AuthContext): Promise<string> {
  const [u] = await db.db.select({ email: users.email, verified: users.emailVerifiedAt }).from(users).where(eq(users.id, auth.userId));
  if (!u || !u.verified || !config.platformAdmins.includes(u.email.toLowerCase())) throw new ForbiddenException();
  return u.email;
}
