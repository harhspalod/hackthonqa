// src/core/services/kb/kb-builder.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, Page } from 'playwright';
import { KbStoreService, KbTree, KbPage, KbFlow } from './kb-store.service';

@Injectable()
export class KbBuilderService {
  private readonly logger = new Logger(KbBuilderService.name);

  constructor(private readonly kbStore: KbStoreService) {}

  async build(siteUrl: string): Promise<KbTree> {
    this.logger.log(`Building KB for ${siteUrl}...`);

    const browser = await chromium.launch({ headless: true });

    try {
      const tree = await this._crawl(browser, siteUrl);
      await this.kbStore.saveTree(siteUrl, tree);
      this.logger.log(`KB built: ${tree.pages.length} pages, ${tree.flows.length} flows`);
      return tree;
    } finally {
      await browser.close();
    }
  }

  private async _crawl(browser: Browser, siteUrl: string): Promise<KbTree> {
    const base     = siteUrl.replace(/\/$/, '');
    const visited  = new Set<string>();
    const queue    = [base];
    const pages:   KbPage[] = [];
    const apis:    { method: string; path: string; last_status: string }[] = [];
    const flows:   KbFlow[] = [];

    while (queue.length > 0 && pages.length < 30) {
      const url = queue.shift()!;
      if (visited.has(url)) continue;
      visited.add(url);

      this.logger.log(`Crawling: ${url}`);

      const page = await browser.newPage();

      // intercept API calls
      const apiCalls: string[] = [];
      page.on('request', req => {
        const u = req.url();
        if (
          req.resourceType() === 'xhr' ||
          req.resourceType() === 'fetch' ||
          u.includes('/api/')
        ) {
          const parsed = new URL(u);
          const entry  = `${req.method()} ${parsed.pathname}`;
          if (!apiCalls.includes(entry)) apiCalls.push(entry);

          // also add to global api list
          const existing = apis.find(a => a.path === parsed.pathname);
          if (!existing) {
            apis.push({
              method:      req.method(),
              path:        parsed.pathname,
              last_status: 'unknown',
            });
          }
        }
      });

      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(1000);

        const kbPage = await this._extractPage(page, url, base, apiCalls);
        pages.push(kbPage);

        // add new links to queue
        for (const link of kbPage.links) {
          const full = link.startsWith('http') ? link : `${base}${link}`;
          if (!visited.has(full) && full.startsWith(base)) {
            queue.push(full);
          }
        }

        // detect flows from page
        const pageFlows = await this._detectFlows(page, url);
        flows.push(...pageFlows);

      } catch (e: any) {
        this.logger.warn(`Failed to crawl ${url}: ${e.message}`);
      } finally {
        await page.close();
      }
    }

    return {
      site:          siteUrl,
      crawled_at:    new Date().toISOString(),
      pages,
      api_endpoints: apis,
      flows,
    };
  }

  private async _extractPage(
    page:     Page,
    url:      string,
    base:     string,
    apiCalls: string[],
  ): Promise<KbPage> {

    const title = await page.title();

    // extract all links
    const links = await page.$$eval('a[href]', els =>
      els.map(el => (el as HTMLAnchorElement).getAttribute('href') ?? '')
         .filter(h => h && !h.startsWith('#') && !h.startsWith('mailto:'))
    );

    // extract interactive elements with labels
    const elements = await page.$$eval(
      'button, [role="button"], input, select, textarea, a[href]',
      els => els.map(el => {
        const text  = (el as HTMLElement).innerText?.trim();
        const label = el.getAttribute('aria-label') ?? '';
        const type  = el.getAttribute('type') ?? el.tagName.toLowerCase();
        const id    = el.getAttribute('id') ?? '';
        const name  = el.getAttribute('name') ?? '';
        return [text, label, type, id, name].filter(Boolean).join('|');
      }).filter(Boolean).slice(0, 50)
    );

    // extract forms
    const forms = await page.$$eval('form', els =>
      els.map(form => {
        const fields = Array.from(form.querySelectorAll('input, select, textarea'))
          .map(f => (f as HTMLInputElement).name || (f as HTMLInputElement).placeholder || (f as HTMLInputElement).type)
          .filter(Boolean);
        const action = (form as HTMLFormElement).action ?? '';
        return { fields, action };
      })
    );

    // extract known errors visible on page
    const known_errors = await page.$$eval(
      '[class*="error"], [class*="Error"], [role="alert"], [class*="toast"]',
      els => els.map(el => (el as HTMLElement).innerText?.trim()).filter(Boolean)
    );

    // get relative url
    const relativeUrl = url.replace(base, '') || '/';

    return {
      url:          relativeUrl,
      title,
      links:        [...new Set(links)].slice(0, 20),
      elements:     [...new Set(elements)],
      forms,
      apis_called:  apiCalls,
      known_errors: [...new Set(known_errors)],
    };
  }

  private async _detectFlows(page: Page, url: string): Promise<KbFlow[]> {
    const flows: KbFlow[] = [];

    // detect scheduling/booking flow
    const hasCalendar = await page.$('[class*="calendar"], [class*="Calendar"], [class*="datepicker"]');
    if (hasCalendar) {
      flows.push({
        name:  'schedule_meeting',
        steps: [
          'navigate to booking page',
          'click Early Access button',
          'select date from calendar',
          'select time slot',
          'click Continue',
          'fill name field',
          'fill email field',
          'fill company field',
          'fill message field',
          'click Schedule Meeting button',
        ],
      });
    }

    // detect login flow
    const hasLogin = await page.$('input[type="password"]');
    if (hasLogin) {
      flows.push({
        name:  'login',
        steps: [
          'navigate to login page',
          'fill email field',
          'fill password field',
          'click login button',
        ],
      });
    }

    // detect signup flow
    const hasSignup = await page.$('input[name*="confirm"], input[name*="register"]');
    if (hasSignup) {
      flows.push({
        name:  'signup',
        steps: [
          'navigate to signup page',
          'fill name field',
          'fill email field',
          'fill password field',
          'click signup button',
        ],
      });
    }

    return flows;
  }
}