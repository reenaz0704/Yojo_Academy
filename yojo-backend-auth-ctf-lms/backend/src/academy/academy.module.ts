import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AcademyNotifyModule } from './academy-notify.module';
import { CareerPathService } from './career-path.service';
import { AdminGamificationController, StudentAcademyController } from './academy.controllers';
import {
  AdminAssessmentsController,
  StudentAssessmentsController,
  TrainerAssessmentsController,
} from './assessments.controllers';
import { AssessmentsService } from './assessments.service';
import {
  AdminCoursesController,
  PublicCoursesController,
  StudentCoursesController,
  TrainerCoursesController,
  AdminCourseChangesController,
} from './courses.controllers';
import { CourseChangesService } from './courses-changes.service';
import { AdminTrainerAttendanceController } from './trainer-attendance.controller';
import { TrainerAttendanceService } from './trainer-attendance.service';
import { FilesController, TrainerCourseFilesController } from './course-files.controller';
import { CourseFilesService } from './course-files.service';
import { TrainerCoursesService } from './courses-trainer.service';
import { CoursesAdminService } from './courses-admin.service';
import { CoursesService } from './courses.service';
import { GamificationService } from './gamification.service';
import { AdminIntelController, IntelController, StudentBlogsController } from './intel.controllers';
import { IntelService } from './intel.service';
import { AdminMissionsController, StudentMissionsController } from './missions.controllers';
import { MissionsService } from './missions.service';
import {
  AdminCertificatesController,
  AdminInsightsController,
  AdminStudentReportsController,
  TrainerInsightsController,
} from './lms-insights.controllers';
import { AdminAnalyticsService } from './admin-analytics.service';
import { StudentReportService } from './student-report.service';
import { LmsInsightsService } from './lms-insights.service';
import {
  AdminNotificationsController,
  AssistantController,
  NotificationsController,
  StudentAnnouncementsController,
  TrainerAnnouncementsController,
} from './notifications.controllers';
import { NotificationsService } from './notifications.service';
import {
  AdminPlacementController,
  StudentPlacementController,
  TrainerPlacementController,
} from './placement.controllers';
import { PlacementService } from './placement.service';
import { StudentDashboardService } from './student-dashboard.service';
import { AdminGridController, StudentGridController, TrainerGridController } from './training-grid.controllers';
import {
  AdminTrainerDeskController,
  StudentFeedbackController,
  TrainerDeskController,
} from './trainer-desk.controllers';
import { TrainerDeskService } from './trainer-desk.service';
import { TrainingGridService } from './training-grid.service';

/**
 * Student Academy (docs/ACADEMY-INVENTORY.md). Slices: (a) XP, streaks, patches, ops, trophies, league;
 * (b) courses, lessons, progress, certificates; (c) Training Grid; (d) assessments; (e) missions and hints; (f) Intel blogs; (g) placement;
 * (h) notifications and the Orbi assistant boundary; (i) Admin/Trainer LMS dashboards and batch overviews;
 * (j) trainer desk: student 360, remarks, admin requests, Lab Monitor, nudges, mentoring outcomes and feedback.
 */
@Module({
  imports: [SettingsModule, AcademyNotifyModule],
  providers: [
    GamificationService,
    CareerPathService,
    StudentDashboardService,
    CoursesService,
    CoursesAdminService,
    TrainerCoursesService,
    CourseChangesService,
    TrainerAttendanceService,
    CourseFilesService,
    TrainingGridService,
    AssessmentsService,
    MissionsService,
    IntelService,
    PlacementService,
    NotificationsService,
    LmsInsightsService,
    StudentReportService,
    AdminAnalyticsService,
    TrainerDeskService,
  ],
  controllers: [
    StudentAcademyController,
    AdminGamificationController,
    PublicCoursesController,
    StudentCoursesController,
    AdminCoursesController,
    TrainerCoursesController,
    AdminCourseChangesController,
    TrainerCourseFilesController,
    FilesController,
    StudentGridController,
    TrainerGridController,
    AdminGridController,
    StudentAssessmentsController,
    TrainerAssessmentsController,
    AdminAssessmentsController,
    StudentMissionsController,
    AdminMissionsController,
    IntelController,
    StudentBlogsController,
    AdminIntelController,
    StudentPlacementController,
    TrainerPlacementController,
    AdminPlacementController,
    NotificationsController,
    AdminNotificationsController,
    TrainerAnnouncementsController,
    StudentAnnouncementsController,
    AdminTrainerAttendanceController,
    AssistantController,
    TrainerInsightsController,
    AdminInsightsController,
    AdminStudentReportsController,
    AdminCertificatesController,
    TrainerDeskController,
    StudentFeedbackController,
    AdminTrainerDeskController,
  ],
  exports: [GamificationService, CoursesService, MissionsService, NotificationsService],
})
export class AcademyModule {}
