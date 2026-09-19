import { Injectable } from '@nestjs/common';
import { LoggerService } from '@app/shared';
import type { Product } from '@app/shared/types/product';

@Injectable()
export class CatalogService {
  private readonly products = new Map<string, Product>();

  constructor(private readonly logger: LoggerService) {}

  add(product: Product): Product {
    this.products.set(product.sku, product);
    this.logger.log('added ' + product.sku);
    return product;
  }

  find(sku: string): Product | undefined {
    return this.products.get(sku);
  }
}
