import { Inject, Injectable } from '@nestjs/common';
import { Clock, CLOCK } from '../common/tokens';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  stamp(): string {
    return this.database.connectionString() + ':' + this.clock.now();
  }
}
