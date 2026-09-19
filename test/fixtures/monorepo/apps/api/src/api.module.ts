import { Module } from '@nestjs/common';
import { LoggerModule } from '@app/shared';
import { CatalogModule } from './catalog/catalog.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [LoggerModule, CatalogModule, HealthModule],
})
export class ApiModule {}
