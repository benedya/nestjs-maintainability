import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { ConfigService } from '../config/config.service';
import { LoggingService } from '../logging/logging.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly config: ConfigService,
    private readonly logging: LoggingService,
    private readonly cache: CacheService,
  ) {}

  find(id: string): string {
    const cached = this.cache.get(id);
    if (cached) {
      return cached;
    }
    this.logging.set('last', id);
    return this.config.get('prefix') + id;
  }
}
