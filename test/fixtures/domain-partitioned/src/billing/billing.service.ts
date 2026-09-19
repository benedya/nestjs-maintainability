import { Injectable, NotFoundException } from '@nestjs/common';
import { BillingRepository } from './billing.repository';
import { Invoice } from './invoice.entity';
import { CreateInvoiceDto } from './create-invoice.dto';
import { OrdersService } from '../orders/orders.service';
import { UsersService } from '../users/users.service';

let counter = 0;

function nextId(): string {
  counter += 1;
  return String(counter);
}

@Injectable()
export class BillingService {
  constructor(
    private readonly repository: BillingRepository,
    private readonly orders: OrdersService,
    private readonly users: UsersService,
  ) {}

  create(dto: CreateInvoiceDto): Invoice {
    this.users.findById(dto.userId);
    this.orders.findById(dto.orderId);
    const row = this.build(dto);
    return this.repository.save(row);
  }

  findById(id: string): Invoice {
    const row = this.repository.findById(id);
    if (!row) {
      throw new NotFoundException('billing ' + id + ' not found');
    }
    return row;
  }

  listForUser(userId: string): Invoice[] {
    return this.repository.findByUser(userId);
  }

  private build(dto: CreateInvoiceDto): Invoice {
    return {
      id: nextId(),
      orderId: dto.orderId,
      userId: dto.userId,
      amount: dto.amount,
      paid: false,
    };
  }

  outstandingForUser(userId: string): number {
    const user = this.users.findById(userId);
    if (!user.active) {
      return 0;
    }
    const invoices = this.repository.findByUser(userId);
    let total = 0;
    for (const invoice of invoices) {
      if (!invoice.paid) {
        total += invoice.amount;
      }
    }
    return total;
  }

  settle(id: string): Invoice {
    const invoice = this.findById(id);
    if (invoice.paid) {
      return invoice;
    }
    const order = this.orders.findById(invoice.orderId);
    if (order.status !== 'cancelled') {
      invoice.paid = true;
    }
    return this.repository.save(invoice);
  }
}
