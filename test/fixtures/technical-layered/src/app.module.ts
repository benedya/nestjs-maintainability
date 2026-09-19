import { Module } from '@nestjs/common';
import { UsersController } from './controllers/users.controller';
import { UsersService } from './services/users.service';
import { UsersRepository } from './repositories/users.repository';
import { OrdersController } from './controllers/orders.controller';
import { OrdersService } from './services/orders.service';
import { OrdersRepository } from './repositories/orders.repository';
import { BillingController } from './controllers/billing.controller';
import { BillingService } from './services/billing.service';
import { BillingRepository } from './repositories/billing.repository';

@Module({
  controllers: [UsersController, OrdersController, BillingController],
  providers: [UsersService, UsersRepository, OrdersService, OrdersRepository, BillingService, BillingRepository],
})
export class AppModule {}
