import { Controller, Get, Module } from '@nestjs/common';
import { AuditController } from './audit/audit.controller';
import { AuthModule } from './auth/auth.module';
import { Public } from './common/request';
import { DbModule } from './db/db.module';
import { EmailModule } from './email/email.module';
import { InvitationsController } from './invitations/invitations.controller';
import { MembersController } from './members/members.controller';
import { NotificationsController } from './notifications/notifications.controller';
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
  controllers: [
    HealthController,
    WorkspacesController,
    TeamsController,
    MembersController,
    InvitationsController,
    NotificationsController,
    AuditController,
    WaitlistController,
  ],
  providers: [WorkspaceGuard],
})
export class AppModule {}
