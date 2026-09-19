import { Module } from '@nestjs/common';
import { UsersModule } from './users/users.module';
import { OrdersModule } from './orders/orders.module';
import { BillingModule } from './billing/billing.module';

@Module({
  imports: [UsersModule, OrdersModule, BillingModule],
})
export class AppModule {}
