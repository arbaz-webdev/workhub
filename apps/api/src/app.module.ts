import { Controller, Get, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AnalyticsService } from './analytics/analytics.service';
import { TrackInterceptor } from './analytics/track';
import { AttendanceSettingsController } from './attendance/attendance-settings.controller';
import { AttendanceController } from './attendance/attendance.controller';
import { CorrectionsController } from './attendance/corrections.controller';
import { SelfieCleanupService } from './attendance/selfie-cleanup.service';
import { AuditController } from './audit/audit.controller';
import { BillingController, PlatformController } from './billing/billing.controller';
import { AuthModule } from './auth/auth.module';
import { Public } from './common/request';
import { CrmController } from './crm/crm.controller';
import { DealsController } from './crm/deals.controller';
import { FollowUpRemindersService } from './crm/reminders.service';
import { CrmImportController } from './crm/import.controller';
import { DbModule } from './db/db.module';
import { EmailModule } from './email/email.module';
import { FeedbackController } from './feedback/feedback.controller';
import { AnnouncementsController } from './inbox/announcements.controller';
import { ChatController } from './inbox/chat.controller';
import { InvitationsController } from './invitations/invitations.controller';
import { LeaveController } from './leave/leave.controller';
import { MembersController } from './members/members.controller';
import { NotificationsController } from './notifications/notifications.controller';
import { OnboardingController } from './onboarding/onboarding.controller';
import { MyWorkController } from './projects/my-work.controller';
import { ProjectsController } from './projects/projects.controller';
import { TasksController } from './projects/tasks.controller';
import { RealtimeService } from './realtime/realtime.service';
import { StatusController } from './status/status.controller';
import { ClientDocsController } from './client-billing/client-docs.controller';
import { PortalController } from './client-billing/portal.controller';
import { PayrollController } from './attendance/payroll.controller';
import { StatusService } from './status/status.service';
import { ReportsController } from './reports/reports.controller';
import { StorageService } from './storage/storage.service';
import { TeamsController } from './teams/teams.controller';
import { TimesheetsController } from './timesheets/timesheets.controller';
import { ApiKeyGuard } from './public-api/api-key.guard';
import { ApiKeysController } from './public-api/api-keys.controller';
import { OpenApiController } from './public-api/openapi';
import { PublicApiV1Controller } from './public-api/v1.controller';
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
    ChatController,
    AnnouncementsController,
    FeedbackController,
    CrmController,
    CrmImportController,
    DealsController,
    ReportsController,
    BillingController,
    PlatformController,
    StatusController,
    ClientDocsController,
    PortalController,
    PayrollController,
    OnboardingController,
    WaitlistController,
    ApiKeysController,
    PublicApiV1Controller,
    OpenApiController,
  ],
  providers: [WorkspaceGuard, ApiKeyGuard, RealtimeService, StorageService, SelfieCleanupService, FollowUpRemindersService, StatusService, AnalyticsService, { provide: APP_INTERCEPTOR, useClass: TrackInterceptor }],
})
export class AppModule {}
