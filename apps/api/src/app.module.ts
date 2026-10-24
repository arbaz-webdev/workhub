import { Controller, Get, Module } from '@nestjs/common';
import { AttendanceSettingsController } from './attendance/attendance-settings.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { CorrectionsController } from './attendance/corrections.controller';
import { SelfieCleanupService } from './attendance/selfie-cleanup.service';
import { AuditController } from './audit/audit.controller';
import { AuthModule } from './auth/auth.module';
import { Public } from './common/request';
import { DbModule } from './db/db.module';
import { EmailModule } from './email/email.module';
import { InvitationsController } from './invitations/invitations.controller';
import { LeaveController } from './leave/leave.controller';
import { MembersController } from './members/members.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { MyWorkController } from './projects/my-work.controller';
import { ProjectsController } from './projects/projects.controller';
import { TasksController } from './projects/tasks.controller';
import { RealtimeService } from './realtime/realtime.service';
import { StorageService } from './storage/storage.service';
import { TeamsController } from './teams/teams.controller';
import { TimesheetsController } from './timesheets/timesheets.controller';
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
    ProjectsController,
    TasksController,
    MyWorkController,
    AttendanceController,
    AttendanceSettingsController,
    CorrectionsController,
    LeaveController,
    TimesheetsController,
    WaitlistController,
  ],
  providers: [WorkspaceGuard, RealtimeService, StorageService, SelfieCleanupService],
})
export class AppModule {}
