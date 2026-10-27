import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { config } from '../config';

export type AnalyticsEvent =
  | 'workspace created'
  | 'member joined'
  | 'project created'
  | 'task created'
  | 'attendance recorded'
  | 'leave requested'
  | 'timesheet submitted'
  | 'message sent'
  | 'announcement posted'
  | 'feedback sent'
  | 'lead created'
  | 'lead converted'
  | 'crm imported'
  | 'deal created'
  | 'deal won'
  | 'activity logged';

type Props = Record<string, string | number | boolean | null>;

/** Ids sent to PostHog are hashed, so its data can't be tied back to a person without our database. */
const pseudonym = (id: string) => createHash('sha256').update(`workhub:${id}`).digest('hex').slice(0, 32);

/**
 * Product analytics, sent from the server to PostHog: which features get used, never
 * what people wrote. No names, emails or message text; no cookies in the browser.
 * Off unless POSTHOG_KEY is set, and never allowed to slow down or fail a request.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger('Analytics');

  capture(event: AnalyticsEvent, who: { userId: string; workspaceId?: string }, props: Props = {}) {
    const posthog = config.posthog;
    if (!posthog) return;
    const body = {
      api_key: posthog.key,
      event,
      distinct_id: pseudonym(who.userId),
      timestamp: new Date().toISOString(),
      properties: {
        ...props,
        ...(who.workspaceId ? { $groups: { workspace: pseudonym(who.workspaceId) } } : {}),
        $process_person_profile: false,
        $lib: 'workhub-api',
      },
    };
    fetch(`${posthog.host}/i/v0/e/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    }).catch((err: unknown) => this.logger.warn(`Could not send "${event}": ${err instanceof Error ? err.message : String(err)}`));
  }
}
