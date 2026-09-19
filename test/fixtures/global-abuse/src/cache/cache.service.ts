import { Injectable } from '@nestjs/common';

@Injectable()
export class CacheService {
  private readonly values = new Map<string, string>();

  get(key: string): string | undefined {
    return this.values.get(key);
  }

  set(key: string, value: string): void {
    this.values.set(key, value);
  }
}
