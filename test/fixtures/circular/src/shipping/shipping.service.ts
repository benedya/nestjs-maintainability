import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service';

@Injectable()
export class ShippingService {
  constructor(
    @Inject(forwardRef(() => OrdersService))
    private readonly orders: OrdersService,
  ) {}

  dispatch(orderId: string): string {
    return 'shipping ' + this.orders.describe(orderId);
  }
}
