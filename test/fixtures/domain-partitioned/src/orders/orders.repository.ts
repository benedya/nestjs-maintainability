import { Injectable } from '@nestjs/common';
import { Order } from './order.entity';

@Injectable()
export class OrdersRepository {
  private readonly rows = new Map<string, Order>();

  save(row: Order): Order {
    this.rows.set(row.id, row);
    return row;
  }

  findById(id: string): Order | undefined {
    return this.rows.get(id);
  }

  findByUser(userId: string): Order[] {
    const found: Order[] = [];
    for (const row of this.rows.values()) {
      if (this.ownerOf(row) === userId) {
        found.push(row);
      }
    }
    return found;
  }

  private ownerOf(row: Order): string {
    return (row as { userId?: string }).userId || row.id;
  }
}
