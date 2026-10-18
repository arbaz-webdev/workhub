import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { originCheck } from './common/origin-check';
import { config } from './config';

/** Middleware shared by the real server and the tests. */
export function configureApp(app: NestExpressApplication) {
  // The web app proxies /api to us from the same machine; trust its X-Forwarded-For.
  app.set('trust proxy', 'loopback');
  app.use(helmet());
  app.use(cookieParser());
  app.use(originCheck(config.webOrigins));
  app.enableShutdownHooks();
  return app;
}
