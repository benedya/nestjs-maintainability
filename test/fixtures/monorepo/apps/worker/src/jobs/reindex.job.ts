import { Injectable } from '@nestjs/common';
import { LoggerService } from '@app/shared';
import type { Product } from '@app/shared/types/product';

@Injectable()
export class ReindexJob {
  constructor(private readonly logger: LoggerService) {}

  run(products: Product[]): number {
    let indexed = 0;
    for (const product of products) {
      if (product.price > 0) {
        indexed += 1;
      }
    }
    this.logger.log('indexed ' + indexed);
    return indexed;
  }
}
