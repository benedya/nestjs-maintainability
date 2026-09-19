import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ShippingService } from '../shipping/shipping.service';

@Injectable()
export class OrdersService {
  constructor(
    @Inject(forwardRef(() => ShippingService))
    private readonly shipping: ShippingService,
  ) {}

  ship(orderId: string): string {
    return this.shipping.dispatch(orderId);
  }

  describe(orderId: string): string {
    return 'order ' + orderId;
  }
}
