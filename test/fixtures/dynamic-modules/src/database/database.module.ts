import { DynamicModule, Module } from '@nestjs/common';
import { DatabaseService } from './database.service';

@Module({})
export class DatabaseModule {
  static forRoot(url: string): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [DatabaseService, { provide: 'DATABASE_URL', useValue: url }],
      exports: [DatabaseService],
    };
  }

  static forRootAsync(): DynamicModule {
    return {
      module: DatabaseModule,
      providers: [DatabaseService],
      exports: [DatabaseService],
    };
  }
}
