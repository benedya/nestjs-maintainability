import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { ShippingModule } from './shipping/shipping.module';

@Module({
  imports: [OrdersModule, ShippingModule],
})
export class AppModule {}
