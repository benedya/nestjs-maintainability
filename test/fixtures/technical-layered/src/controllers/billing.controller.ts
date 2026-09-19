import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BillingService } from '../services/billing.service';
import { CreateInvoiceDto } from '../dtos/create-invoice.dto';
import { Invoice } from '../entities/invoice.entity';

@Controller('billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}

  @Post()
  create(@Body() dto: CreateInvoiceDto): Invoice {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string): Invoice {
    return this.service.findById(id);
  }

  @Get()
  listForUser(@Param('userId') userId: string): Invoice[] {
    return this.service.listForUser(userId);
  }
}
