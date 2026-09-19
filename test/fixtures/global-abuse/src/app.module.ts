import { Module } from '@nestjs/common';
import { CacheModule } from './cache/cache.module';
import { ConfigModule } from './config/config.module';
import { LoggingModule } from './logging/logging.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [ConfigModule, LoggingModule, CacheModule, OrdersModule],
})
export class AppModule {}
