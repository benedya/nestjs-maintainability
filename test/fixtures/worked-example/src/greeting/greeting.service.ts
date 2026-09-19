import { Injectable } from '@nestjs/common';

@Injectable()
export class GreetingService {
  private readonly seen = new Set<string>();

  greet(name: string): string {
    if (this.seen.has(name)) {
      return 'Welcome back, ' + name;
    }
    this.seen.add(name);
    return 'Hello, ' + name;
  }
}
