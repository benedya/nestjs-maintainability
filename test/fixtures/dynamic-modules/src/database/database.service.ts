import { Inject, Injectable } from '@nestjs/common';

@Injectable()
export class DatabaseService {
  constructor(@Inject('DATABASE_URL') private readonly url: string) {}

  connectionString(): string {
    return this.url;
  }
}
