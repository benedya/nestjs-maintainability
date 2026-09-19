import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './create-order.dto';
import { Order } from './order.entity';

@Controller('orders')
export class OrdersController {
  constructor(private readonly service: OrdersService) {}

  @Post()
  create(@Body() dto: CreateOrderDto): Order {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Order {
    return this.service.findById(id);
  }

  @Get()
  listForUser(@Param('userId') userId: string): Order[] {
    return this.service.listForUser(userId);
  }
}
