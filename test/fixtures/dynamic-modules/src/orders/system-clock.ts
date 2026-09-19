import { Injectable } from '@nestjs/common';
import { Clock } from '../common/tokens';

@Injectable()
export class SystemClock implements Clock {
  now(): number {
    return Date.now();
  }
}
