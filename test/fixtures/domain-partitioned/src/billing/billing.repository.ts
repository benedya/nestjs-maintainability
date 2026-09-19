import { Injectable } from '@nestjs/common';
import { Invoice } from './invoice.entity';

@Injectable()
export class BillingRepository {
  private readonly rows = new Map<string, Invoice>();

  save(row: Invoice): Invoice {
    this.rows.set(row.id, row);
    return row;
  }

  findById(id: string): Invoice | undefined {
    return this.rows.get(id);
  }

  findByUser(userId: string): Invoice[] {
    const found: Invoice[] = [];
    for (const row of this.rows.values()) {
      if (this.ownerOf(row) === userId) {
        found.push(row);
      }
    }
    return found;
  }

  private ownerOf(row: Invoice): string {
    return (row as { userId?: string }).userId || row.id;
  }
}
