import { Injectable, Logger }          from '@nestjs/common';
import { chromium, Page }              from 'playwright';
import { KbStoreService, KbPage }      from './kb-store.service';
import { GeminiFlash }                 from '@/infra/services/gemini-flash';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { JsonOutputParser }            from '@langchain/core/output_parsers';

export interface ExecutionResult {
  url:          string;
  status:       'passed' | 'failed' | 'error';
  issue_found:  boolean;
  summary:      string;
  errors_found: string[];
}

@Injectable()
export class KbExecutorService {
  private readonly logger = new Logger(KbExecutorService.name);
  private readonly llm    = new GeminiFlash();

  constructor(private readonly kbStore: KbStoreService) {}

  async executeAndCheck(
    siteUrl:   string,
    targetUrl: string,
    issue:     string,
    kbPage:    KbPage | null,
  ): Promise<ExecutionResult> {
    this.logger.log(`Direct KB check → ${targetUrl}`);

    const wsEndpoint = process.env.PLAYWRIGHT_WS_ENDPOINT ?? null;
    const browser    = wsEndpoint
      ? await chromium.connect(wsEndpoint)
      : await chromium.launch({ headless: true });

    const page = await browser.newPage();

    try {
      // step 1 — go directly to URL
      await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);
      this.logger.log(`Loaded: ${targetUrl}`);

      // step 2 — execute flow from KB without AI
      await this._executeFlow(page, siteUrl, targetUrl, kbPage);

      // step 3 — capture result
      const screenshotBuffer = await page.screenshot({ fullPage: false });
      const screenshotBase64 = screenshotBuffer.toString('base64');

      const pageContent = await page.evaluate(() =>
        document.body.innerText.slice(0, 3000)
      );

      const visibleErrors = await page.$$eval(
        '[class*="error"],[class*="Error"],[role="alert"],[class*="toast"],[class*="fail"]',
        els => els.map(el => (el as HTMLElement).innerText?.trim()).filter(Boolean)
      );

      this.logger.log(`Errors visible: ${visibleErrors.join(', ') || 'none'}`);

      // step 4 — send to AI once
      this.logger.log(`One-shot AI analysis...`);
      const analysis = await this._analyzeOnce(
        issue, pageContent, visibleErrors, screenshotBase64, targetUrl
      );

      // step 5 — update KB with new errors found
      if (visibleErrors.length > 0 && kbPage) {
        const updatedPage = {
          ...kbPage,
          known_errors: [...new Set([...kbPage.known_errors, ...visibleErrors])],
        };
        await this.kbStore.updatePage(siteUrl, updatedPage);
        this.logger.log(`KB updated with new errors`);
      }

      this.logger.log(`Result: ${analysis.summary}`);

      return {
        url:          targetUrl,
        status:       analysis.issue_found ? 'failed' : 'passed',
        issue_found:  analysis.issue_found,
        summary:      analysis.summary,
        errors_found: visibleErrors,
      };

    } catch (e: any) {
      this.logger.error(`Execution error: ${e.message}`);
      return {
        url:          targetUrl,
        status:       'error',
        issue_found:  false,
        summary:      `Error: ${e.message}`,
        errors_found: [],
      };
    } finally {
      await page.close();
      await browser.close();
    }
  }

  private async _executeFlow(
  page:      Page,
  siteUrl:   string,
  targetUrl: string,
  kbPage:    KbPage | null,
): Promise<void> {
  this.logger.log(`Executing flow...`);

  try {
    // step 1 — click first available date
    // from screenshot: dates are buttons with just numbers
    // available dates are not greyed out
    const dateClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const dateBtn = buttons.find(btn => {
        const text = btn.innerText?.trim();
        const num  = parseInt(text);
        if (isNaN(num) || num < 1 || num > 31) return false;
        const style    = window.getComputedStyle(btn);
        const disabled = btn.hasAttribute('disabled');
        const opacity  = parseFloat(style.opacity);
        return !disabled && opacity > 0.5;
      });
      if (dateBtn) { dateBtn.click(); return dateBtn.innerText.trim(); }
      return null;
    });

    if (dateClicked) {
      this.logger.log(`Clicked date: ${dateClicked}`);
      await page.waitForTimeout(2000);
    }

    // step 2 — click first available time slot
    // from screenshot: "9:00 AM", "9:30 AM" etc
    const timeClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const timeBtn = buttons.find(btn => {
        const text = btn.innerText?.trim();
        return /^\d{1,2}:\d{2}\s*(AM|PM)$/i.test(text) &&
               !btn.hasAttribute('disabled');
      });
      if (timeBtn) { timeBtn.click(); return timeBtn.innerText.trim(); }
      return null;
    });

    if (timeClicked) {
      this.logger.log(`Clicked time: ${timeClicked}`);
      await page.waitForTimeout(1500);
    }

    // step 3 — click Continue
    const continueClicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b =>
        /continue|next|proceed/i.test(b.innerText?.trim())
      );
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (continueClicked) {
      this.logger.log(`Clicked Continue`);
      await page.waitForTimeout(2000);
    }

    // step 4 — fill form fields
    await this._fillForm(page, kbPage);

    // step 5 — click submit
    const submitted = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b =>
        /schedule|submit|book|confirm/i.test(b.innerText?.trim())
      );
      if (btn) { btn.click(); return btn.innerText.trim(); }
      return null;
    });

    if (submitted) {
      this.logger.log(`Clicked submit: ${submitted}`);
      await page.waitForTimeout(3000);
    }

  } catch (e: any) {
    this.logger.warn(`Flow error: ${e.message}`);
  }
}
  private async _fillForm(page: Page, kbPage: KbPage | null): Promise<void> {
    // use KB form fields if available
    if (kbPage?.forms?.length) {
      for (const form of kbPage.forms) {
        for (const field of form.fields) {
          const sel = [
            `input[name*="${field}"]`,
            `input[placeholder*="${field}"]`,
            `textarea[name*="${field}"]`,
            `textarea[placeholder*="${field}"]`,
          ].join(', ');
          const el = await page.$(sel);
          if (el) {
            await el.fill(this._dummyValue(field));
            await page.waitForTimeout(200);
            this.logger.log(`Filled: ${field}`);
          }
        }
      }
    } else {
      // fallback common fields
      const common = [
        { sel: 'input[name*="name"], input[placeholder*="name"], input[placeholder*="Name"]',          val: 'QA Test' },
        { sel: 'input[name*="email"], input[placeholder*="email"], input[placeholder*="Email"]',        val: 'qa@test.com' },
        { sel: 'input[name*="company"], input[placeholder*="company"], input[placeholder*="Company"]',  val: 'QA Corp' },
        { sel: 'textarea',                                                                               val: 'Automated QA check' },
      ];
      for (const { sel, val } of common) {
        const el = await page.$(sel);
        if (el) {
          await el.fill(val);
          await page.waitForTimeout(200);
          this.logger.log(`Filled fallback: ${val}`);
        }
      }
    }
  }

  private _dummyValue(field: string): string {
    const f = field.toLowerCase();
    if (f.includes('email'))   return 'qa@test.com';
    if (f.includes('name'))    return 'QA Test';
    if (f.includes('company')) return 'QA Corp';
    if (f.includes('phone'))   return '+1234567890';
    if (f.includes('message')) return 'Automated QA check';
    return 'QA Test';
  }

  private async _analyzeOnce(
    issue:         string,
    pageContent:   string,
    visibleErrors: string[],
    screenshotB64: string,
    url:           string,
  ): Promise<{ issue_found: boolean; summary: string }> {
    try {
      const parser = new JsonOutputParser<{
        issue_found: boolean;
        summary:     string;
      }>();

      const system = new SystemMessage(
        `You are a QA engineer. Look at the screenshot and page content.
         Respond ONLY with valid JSON: {"issue_found": boolean, "summary": "one clear sentence"}`
      );

      const human = new HumanMessage({
        content: [
          {
            type:      'image_url',
            image_url: { url: `data:image/png;base64,${screenshotB64}` },
          },
          {
            type: 'text',
            text: `Page URL: ${url}
Issue to verify: "${issue}"
Visible errors on page: ${visibleErrors.join(', ') || 'none'}
Page text:
${pageContent}

Does the issue exist? JSON only.`,
          },
        ],
      });

      return await this.llm.invokeAndParse([system, human], parser);

    } catch (e: any) {
      this.logger.warn(`AI fallback: ${e.message}`);
      const issueFound = visibleErrors.length > 0;
      return {
        issue_found: issueFound,
        summary:     issueFound
          ? `Issue confirmed: ${visibleErrors[0]}`
          : `No visible errors found on ${url}`,
      };
    }
  }
}
