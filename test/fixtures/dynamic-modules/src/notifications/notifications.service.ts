import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  send(message: string): string {
    return message;
  }
}
