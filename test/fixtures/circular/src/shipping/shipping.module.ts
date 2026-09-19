import { forwardRef, Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { ShippingService } from './shipping.service';

@Module({
  imports: [forwardRef(() => OrdersModule)],
  providers: [ShippingService],
  exports: [ShippingService],
})
export class ShippingModule {}
