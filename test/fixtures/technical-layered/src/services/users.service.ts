import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersRepository } from '../repositories/users.repository';
import { User } from '../entities/user.entity';
import { CreateUserDto } from '../dtos/create-user.dto';

let counter = 0;

function nextId(): string {
  counter += 1;
  return String(counter);
}

@Injectable()
export class UsersService {
  constructor(
    private readonly repository: UsersRepository,
  ) {}

  create(dto: CreateUserDto): User {
    const row = this.build(dto);
    return this.repository.save(row);
  }

  findById(id: string): User {
    const row = this.repository.findById(id);
    if (!row) {
      throw new NotFoundException('users ' + id + ' not found');
    }
    return row;
  }

  listForUser(userId: string): User[] {
    return this.repository.findByUser(userId);
  }

  private build(dto: CreateUserDto): User {
    return {
      id: nextId(),
      email: dto.email,
      name: dto.name,
      active: true,
    };
  }

  activate(id: string): User {
    const user = this.findById(id);
    if (!user.active) {
      user.active = true;
      this.repository.save(user);
    }
    return user;
  }

  describe(user: User): string {
    if (!user.name && !user.email) {
      return 'anonymous';
    }
    if (user.name && user.email) {
      return user.name + ' <' + user.email + '>';
    }
    return user.name || user.email;
  }
}
