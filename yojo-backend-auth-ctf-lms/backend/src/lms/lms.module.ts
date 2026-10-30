import { Module } from '@nestjs/common';
import { AdminUsersService } from './admin-users.service';
import { BatchesService } from './batches.service';
import { AdminUsersController, TrainerController } from './lms.controllers';

@Module({
  providers: [AdminUsersService, BatchesService],
  controllers: [AdminUsersController, TrainerController],
})
export class LmsModule {}
