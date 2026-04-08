import { Controller, Post, Body, Get, Logger } from '@nestjs/common';
import { KbStoreService }   from '@/core/services/kb/kb-store.service';
import { KbBuilderService } from '@/core/services/kb/kb-builder.service';
import { RunTestCase }      from '@/app/usecases/run-test-case';

export class SignalDto {
  site_url:  string;
  issue:     string;
  page?:     string;
  source?:   string;
  severity?: string;
  metadata?: Record<string, any>;
}

@Controller('signal')
export class SignalController {
  private readonly logger = new Logger(SignalController.name);

  constructor(
    private readonly kbStore:   KbStoreService,
    private readonly kbBuilder: KbBuilderService,
  ) {}

  @Post()
  async receiveSignal(@Body() signal: SignalDto) {
    this.logger.log(`Signal: site=${signal.site_url} issue="${signal.issue}" source=${signal.source ?? 'unknown'}`);

    const siteUrl = signal.site_url.replace(/\/$/, '');

    // 1. build KB if first time
    const kbExists = await this.kbStore.exists(siteUrl);
    if (!kbExists) {
      this.logger.log(`No KB — building now...`);
      await this.kbBuilder.build(siteUrl);
    }

    // 2. find affected page from KB
    const kbPage    = await this.kbStore.findAffectedPage(siteUrl, signal.issue, signal.page);
    const targetUrl = kbPage ? `${siteUrl}${kbPage.url}` : siteUrl;

    this.logger.log(`KB mapped to: ${targetUrl}`);
    this.logger.log(`Known errors: ${kbPage?.known_errors?.join(', ') || 'none'}`);

    // 3. build user story with KB context
    const userStory = this._buildStory(signal, kbPage);
    this.logger.log(`Story: ${userStory}`);

    // 4. run existing agent starting at the mapped URL — not homepage
    const runTestCase = new RunTestCase();
    runTestCase
      .execute(targetUrl, userStory)
      .then(result => {
        this.logger.log(`Agent done: ${result.status} — ${result.reason}`);

        // save result to file
        const fs      = require('fs');
        const path    = require('path');
        const dir     = path.join(process.cwd(), 'results');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

        const record = {
          timestamp:  new Date().toISOString(),
          site_url:   siteUrl,
          target_url: targetUrl,
          kb_page:    kbPage?.url ?? '/',
          issue:      signal.issue,
          source:     signal.source ?? 'unknown',
          severity:   signal.severity ?? 'medium',
          status:     result.status,
          reason:     result.reason,
        };

        const filename = `${Date.now()}_${result.status}.json`;
        fs.writeFileSync(
          path.join(dir, filename),
          JSON.stringify(record, null, 2)
        );

        this.logger.log(`Result saved: results/${filename}`);

        // update KB with errors
        if (kbPage && result.reason && result.status === 'failed') {
          this.kbStore.updatePage(siteUrl, {
            ...kbPage,
            known_errors: [
              ...new Set([...kbPage.known_errors, result.reason])
            ].slice(0, 10),
          });
        }
      })
      .catch(err => this.logger.error(`Agent error: ${err.message}`));

    // return immediately
    return {
      status:      'running',
      target_url:  targetUrl,
      kb_used:     kbExists,
      kb_page:     kbPage?.url ?? '/',
      known_errors: kbPage?.known_errors ?? [],
      user_story:  userStory,
    };
  }

  @Get('kb')
  async listKbs() {
    return this.kbStore.listAll();
  }

  @Post('kb/build')
  async buildKb(@Body() body: { site_url: string }) {
    this.logger.log(`Manual KB build for ${body.site_url}`);
    const tree = await this.kbBuilder.build(body.site_url);
    return {
      status:     'ok',
      pages:      tree.pages.length,
      flows:      tree.flows.length,
      crawled_at: tree.crawled_at,
    };
  }

  @Post('kb/reset')
  async resetKb(@Body() body: { site_url: string }) {
    await this.kbStore.deleteKb(body.site_url);
    return { status: 'ok', message: `KB deleted for ${body.site_url}` };
  }

  private _buildStory(signal: SignalDto, kbPage: any): string {
    let story = `You are on the correct page already. Check if this issue exists: "${signal.issue}".`;

    if (kbPage?.known_errors?.length > 0) {
      story += ` Previously known errors: ${kbPage.known_errors.join(', ')}.`;
    }

    if (kbPage?.forms?.length > 0) {
      const fields = kbPage.forms[0].fields.join(', ');
      story += ` Form fields on this page: ${fields}.`;
    }

    story += ` Complete the full flow on this page, reproduce the issue if possible, and report exactly what you find.`;

    return story;
  }
}