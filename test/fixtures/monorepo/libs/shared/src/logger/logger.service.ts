import { Injectable } from '@nestjs/common';

@Injectable()
export class LoggerService {
  private readonly lines: string[] = [];

  log(message: string): void {
    this.lines.push(message);
  }

  history(): string[] {
    return this.lines;
  }
}
