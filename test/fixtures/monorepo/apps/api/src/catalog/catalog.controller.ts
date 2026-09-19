import { Controller, Get, Param } from '@nestjs/common';
import type { Product } from '@app/shared/types/product';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get(':sku')
  find(@Param('sku') sku: string): Product | undefined {
    return this.catalog.find(sku);
  }
}
