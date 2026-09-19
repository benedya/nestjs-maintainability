import { forwardRef, Module } from '@nestjs/common';
import { ShippingModule } from '../shipping/shipping.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [forwardRef(() => ShippingModule)],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
