import { Controller, Get, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { Public } from './common/request';
import { DbModule } from './db/db.module';
import { EmailModule } from './email/email.module';
import { TeamsController } from './teams/teams.controller';
import { WaitlistController } from './waitlist/waitlist.controller';
import { WorkspaceGuard } from './workspaces/workspace.guard';
import { WorkspacesController } from './workspaces/workspaces.controller';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [DbModule, EmailModule, AuthModule],
  controllers: [HealthController, WorkspacesController, TeamsController, WaitlistController],
  providers: [WorkspaceGuard],
})
export class AppModule {}
