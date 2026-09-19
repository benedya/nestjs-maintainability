import { Module } from '@nestjs/common';
import { LoggerModule } from '@app/shared';
import { ReindexJob } from './reindex.job';

@Module({
  imports: [LoggerModule],
  providers: [ReindexJob],
})
export class JobsModule {}
