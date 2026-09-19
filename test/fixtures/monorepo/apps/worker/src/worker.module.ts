import { Module } from '@nestjs/common';
import { LoggerModule } from '@app/shared';
import { JobsModule } from './jobs/jobs.module';

@Module({
  imports: [LoggerModule, JobsModule],
})
export class WorkerModule {}
