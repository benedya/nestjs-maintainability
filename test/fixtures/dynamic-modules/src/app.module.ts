import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersModule } from './orders/orders.module';

const INFRASTRUCTURE = [DatabaseModule.forRoot('postgres://localhost/app')];

@Module({
  imports: [
    ...INFRASTRUCTURE,
    NotificationsModule.register('email'),
    OrdersModule,
    buildFeatureModule(),
  ],
})
export class AppModule {}

function buildFeatureModule() {
  return NotificationsModule.registerAsync();
}
