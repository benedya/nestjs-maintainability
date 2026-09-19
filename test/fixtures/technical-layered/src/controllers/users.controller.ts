import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { CreateUserDto } from '../dtos/create-user.dto';
import { User } from '../entities/user.entity';

@Controller('users')
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto): User {
    return this.service.create(dto);
  }

  @Get(':id')
  findOne(@Param('id') id: string): User {
    return this.service.findById(id);
  }

  @Get()
  listForUser(@Param('userId') userId: string): User[] {
    return this.service.listForUser(userId);
  }
}
