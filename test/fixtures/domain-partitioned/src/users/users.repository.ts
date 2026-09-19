import { Injectable } from '@nestjs/common';
import { User } from './user.entity';

@Injectable()
export class UsersRepository {
  private readonly rows = new Map<string, User>();

  save(row: User): User {
    this.rows.set(row.id, row);
    return row;
  }

  findById(id: string): User | undefined {
    return this.rows.get(id);
  }

  findByUser(userId: string): User[] {
    const found: User[] = [];
    for (const row of this.rows.values()) {
      if (this.ownerOf(row) === userId) {
        found.push(row);
      }
    }
    return found;
  }

  private ownerOf(row: User): string {
    return (row as { userId?: string }).userId || row.id;
  }
}
