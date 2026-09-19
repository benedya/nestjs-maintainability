import { Module } from '@nestjs/common';
import { GreetingService } from './greeting.service';

@Module({
  providers: [GreetingService],
  exports: [GreetingService],
})
export class GreetingModule {}
