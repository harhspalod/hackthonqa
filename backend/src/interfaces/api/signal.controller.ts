// src/interfaces/api/signal.controller.ts
import { Controller, Post, Body, Get, Logger } from '@nestjs/common';
import { KbStoreService }   from '@/core/services/kb/kb-store.service';
import { KbBuilderService } from '@/core/services/kb/kb-builder.service';
import { RunTestCase }      from '@/app/usecases/run-test-case';

export class SignalDto {
  site_url:    string;   // https://bharatmcp.com
  issue:       string;   // "schedule button failing"
  page?:       string;   // "/booking" — optional
  source?:     string;   // "twitter" | "github" | "monitoring"
  severity?:   string;   // "high" | "medium" | "low"
  metadata?:   Record<string, any>;
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
    this.logger.log(
      `Signal received: site=${signal.site_url} issue="${signal.issue}" source=${signal.source ?? 'unknown'}`
    );

    const siteUrl = signal.site_url.replace(/\/$/, '');

    // 1. check if KB exists — if not build it first
    const kbExists = await this.kbStore.exists(siteUrl);

    if (!kbExists) {
      this.logger.log(`No KB found for ${siteUrl} — building now...`);
      await this.kbBuilder.build(siteUrl);
      this.logger.log(`KB built for ${siteUrl}`);
    }

    // 2. find affected page from KB
    const affectedPage = await this.kbStore.findAffectedPage(
      siteUrl,
      signal.issue,
      signal.page,
    );

    const targetUrl = affectedPage
      ? `${siteUrl}${affectedPage.url}`
      : siteUrl;

    this.logger.log(`Affected page found: ${targetUrl}`);
    this.logger.log(`Known elements: ${affectedPage?.elements?.slice(0, 5).join(', ')}`);
    this.logger.log(`Known errors: ${affectedPage?.known_errors?.join(', ') ?? 'none'}`);

    // 3. build smart user story from KB context
    const userStory = this._buildUserStory(signal, affectedPage);

    this.logger.log(`Running agent with story: ${userStory}`);

    // 4. run agent — non-blocking so we return immediately
    const runTestCase = new RunTestCase();
    runTestCase
      .execute(targetUrl, userStory)
      .then(result => {
        this.logger.log(`Agent result: ${result.status} — ${result.reason}`);
      })
      .catch(err => {
        this.logger.error(`Agent failed: ${err.message}`);
      });

    // 5. return immediately with context
    return {
      status:       'running',
      site_url:     siteUrl,
      target_url:   targetUrl,
      kb_used:      kbExists,
      affected_page: affectedPage?.url ?? '/',
      known_errors: affectedPage?.known_errors ?? [],
      user_story:   userStory,
      message:      'Agent is running — check logs for result',
    };
  }

  @Get('kb')
  async listKbs() {
    return this.kbStore.listAll();
  }

  @Post('kb/build')
  async buildKb(@Body() body: { site_url: string }) {
    this.logger.log(`Manual KB build requested for ${body.site_url}`);
    const tree = await this.kbBuilder.build(body.site_url);
    return {
      status:     'ok',
      site:       body.site_url,
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

  private _buildUserStory(
    signal:     SignalDto,
    kbPage:     any,
  ): string {
    let story = `Check if the following issue exists on this page: "${signal.issue}".`;

    // add known flow context
    if (kbPage?.forms?.length > 0) {
      const fields = kbPage.forms[0].fields.join(', ');
      story += ` The page has a form with fields: ${fields}.`;
    }

    // add known errors context
    if (kbPage?.known_errors?.length > 0) {
      story += ` Previously known errors on this page: ${kbPage.known_errors.join(', ')}.`;
    }

    // add elements context
    if (kbPage?.elements?.length > 0) {
      const btns = kbPage.elements
        .filter((e: string) => e.toLowerCase().includes('button') || e.toLowerCase().includes('submit'))
        .slice(0, 3);
      if (btns.length > 0) {
        story += ` Key buttons on this page: ${btns.join(', ')}.`;
      }
    }

    story += ` Verify the issue, report what you find, and confirm if the problem is reproducible.`;

    return story;
  }
}