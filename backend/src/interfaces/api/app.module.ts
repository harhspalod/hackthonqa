import { Module }           from '@nestjs/common';
import { AppController }    from './app.controller';
import { AppService }       from './app.service';
import { JobsModule }       from './jobs/jobs.module';
import { KbStoreService }   from '@/core/services/kb/kb-store.service';
import { KbBuilderService } from '@/core/services/kb/kb-builder.service';
import { SignalController } from './signal.controller';

@Module({
  imports:     [JobsModule],
  controllers: [AppController, SignalController],
  providers:   [AppService, KbStoreService, KbBuilderService],
})
export class AppModule {}
