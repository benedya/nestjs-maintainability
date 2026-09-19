import { Module } from '@nestjs/common';
import { CLOCK } from '../common/tokens';
import { DatabaseModule } from '../database/database.module';
import { OrdersService } from './orders.service';
import { SystemClock } from './system-clock';

@Module({
  imports: [DatabaseModule.forRootAsync()],
  providers: [
    OrdersService,
    { provide: CLOCK, useClass: SystemClock },
    {
      provide: 'ORDER_LIMIT',
      useFactory: (clock: SystemClock) => clock.now() % 100,
      inject: [CLOCK],
    },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
