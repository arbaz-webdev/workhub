import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  // HOST=127.0.0.1 keeps the API reachable only from inside its machine or container.
  if (config.host) await app.listen(config.port, config.host);
  else await app.listen(config.port);
  console.log(`API listening on http://${config.host ?? 'localhost'}:${config.port}`);
}

void bootstrap();
