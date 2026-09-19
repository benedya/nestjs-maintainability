import { Injectable, NotFoundException } from '@nestjs/common';
import { OrdersRepository } from '../repositories/orders.repository';
import { Order } from '../entities/order.entity';
import { CreateOrderDto } from '../dtos/create-order.dto';
import { UsersService } from './users.service';

let counter = 0;

function nextId(): string {
  counter += 1;
  return String(counter);
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly users: UsersService,
  ) {}

  create(dto: CreateOrderDto): Order {
    this.users.findById(dto.userId);
    const row = this.build(dto);
    return this.repository.save(row);
  }

  findById(id: string): Order {
    const row = this.repository.findById(id);
    if (!row) {
      throw new NotFoundException('orders ' + id + ' not found');
    }
    return row;
  }

  listForUser(userId: string): Order[] {
    return this.repository.findByUser(userId);
  }

  private build(dto: CreateOrderDto): Order {
    return {
      id: nextId(),
      userId: dto.userId,
      total: dto.total,
      status: 'pending',
    };
  }

  totalForUser(userId: string): number {
    const orders = this.repository.findByUser(userId);
    let total = 0;
    for (const order of orders) {
      if (order.status === 'cancelled') {
        continue;
      }
      if (order.status === 'pending' || order.status === 'paid') {
        total += order.total;
      }
    }
    return total;
  }

  cancel(id: string): Order {
    const order = this.findById(id);
    if (order.status === 'paid') {
      throw new NotFoundException('paid orders cannot be cancelled');
    }
    order.status = 'cancelled';
    return this.repository.save(order);
  }
}
