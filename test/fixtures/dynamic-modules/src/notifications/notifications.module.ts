import { DynamicModule, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Module({})
export class NotificationsModule {
  static register(channel: string): DynamicModule {
    return {
      module: NotificationsModule,
      providers: [NotificationsService, { provide: 'CHANNEL', useValue: channel }],
      exports: [NotificationsService],
    };
  }

  static registerAsync(): DynamicModule {
    return { module: NotificationsModule, providers: [NotificationsService] };
  }
}
