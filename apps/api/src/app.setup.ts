import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { originCheck } from './common/origin-check';
import { config } from './config';

/** Middleware shared by the real server and the tests. */
export function configureApp(app: NestExpressApplication) {
  // Locally the web app proxies /api to us from the same machine. Hosted, there are more
  // hops (e.g. Render's edge, then the web app), set by TRUST_PROXY, so req.ip is the
  // visitor's address for rate limits and office-IP rules, not the last proxy's.
  app.set('trust proxy', config.trustProxy);
  app.use(helmet());
  app.use(cookieParser());
  app.use(originCheck(config.webOrigins));
  app.enableShutdownHooks();
  return app;
}
