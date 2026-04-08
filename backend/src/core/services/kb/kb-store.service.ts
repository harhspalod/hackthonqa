import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface KbPage {
  url:          string;
  title:        string;
  links:        string[];
  elements:     string[];
  forms:        { fields: string[]; action: string }[];
  apis_called:  string[];
  known_errors: string[];
}

export interface KbFlow {
  name:  string;
  steps: string[];
}

export interface KbTree {
  site:          string;
  crawled_at:    string;
  pages:         KbPage[];
  api_endpoints: { method: string; path: string; last_status: string }[];
  flows:         KbFlow[];
}

export interface KbMeta {
  site:        string;
  crawled_at:  string;
  page_count:  number;
  flow_count:  number;
}

@Injectable()
export class KbStoreService {
  private readonly logger = new Logger(KbStoreService.name);
  private readonly kbDir  = path.join(process.cwd(), 'kb');

  private siteToFolder(siteUrl: string): string {
    return siteUrl
      .replace(/^https?:\/\//, '')
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  async exists(siteUrl: string): Promise<boolean> {
    const folder   = path.join(this.kbDir, this.siteToFolder(siteUrl));
    const treePath = path.join(folder, 'tree.json');
    try {
      await fs.access(treePath);
      return true;
    } catch {
      return false;
    }
  }

  async saveTree(siteUrl: string, tree: KbTree): Promise<void> {
    const folder = path.join(this.kbDir, this.siteToFolder(siteUrl));
    await this.ensureDir(folder);

    const treePath = path.join(folder, 'tree.json');
    await fs.writeFile(treePath, JSON.stringify(tree, null, 2));

    const meta: KbMeta = {
      site:       siteUrl,
      crawled_at: tree.crawled_at,
      page_count: tree.pages.length,
      flow_count: tree.flows.length,
    };
    await fs.writeFile(path.join(folder, 'meta.json'), JSON.stringify(meta, null, 2));
    this.logger.log(`KB saved: ${tree.pages.length} pages`);
  }

  async loadTree(siteUrl: string): Promise<KbTree | null> {
    const folder   = path.join(this.kbDir, this.siteToFolder(siteUrl));
    const treePath = path.join(folder, 'tree.json');
    try {
      const raw = await fs.readFile(treePath, 'utf-8');
      return JSON.parse(raw) as KbTree;
    } catch {
      return null;
    }
  }

  async updatePage(siteUrl: string, page: KbPage): Promise<void> {
    const tree = await this.loadTree(siteUrl);
    if (!tree) return;
    const idx = tree.pages.findIndex(p => p.url === page.url);
    if (idx >= 0) tree.pages[idx] = page;
    else tree.pages.push(page);
    await this.saveTree(siteUrl, tree);
  }

  async findAffectedPage(
    siteUrl: string,
    signal:  string,
    page?:   string,
  ): Promise<KbPage | null> {
    const tree = await this.loadTree(siteUrl);
    if (!tree) return null;

    // exact page match
    if (page) {
      const found = tree.pages.find(p => p.url === page);
      if (found) return found;
    }

    const lower = signal.toLowerCase();

    // keyword → page mapping
    const keywordMap: Record<string, string[]> = {
      'schedule':  ['/talk-with-us', '/booking', '/early-access'],
      'meeting':   ['/talk-with-us', '/booking'],
      'book':      ['/talk-with-us', '/booking'],
      'calendar':  ['/talk-with-us', '/booking'],
      'login':     ['/login', '/auth', '/signin'],
      'signup':    ['/signup', '/register'],
      'payment':   ['/payment', '/checkout'],
      'contact':   ['/contact', '/talk-with-us'],
      'access':    ['/early-access'],
    };

    for (const [keyword, urls] of Object.entries(keywordMap)) {
      if (lower.includes(keyword)) {
        for (const targetPath of urls) {
          const found = tree.pages.find(p => p.url === targetPath);
          if (found) return found;
        }
      }
    }

    // fuzzy match
    const fuzzy = tree.pages.find(p =>
      p.url.toLowerCase().includes(lower) ||
      p.known_errors.some(e => e.toLowerCase().includes(lower)) ||
      p.elements.some(e => e.toLowerCase().includes(lower))
    );
    if (fuzzy) return fuzzy;

    // default — first non-home page
    return tree.pages.find(p => p.url !== '/') ?? tree.pages[0] ?? null;
  }

  async listAll(): Promise<KbMeta[]> {
    try {
      await this.ensureDir(this.kbDir);
      const folders = await fs.readdir(this.kbDir);
      const metas: KbMeta[] = [];
      for (const folder of folders) {
        try {
          const raw = await fs.readFile(
            path.join(this.kbDir, folder, 'meta.json'), 'utf-8'
          );
          metas.push(JSON.parse(raw));
        } catch { continue; }
      }
      return metas;
    } catch { return []; }
  }

  async deleteKb(siteUrl: string): Promise<void> {
    const folder = path.join(this.kbDir, this.siteToFolder(siteUrl));
    await fs.rm(folder, { recursive: true, force: true });
    this.logger.log(`KB deleted for ${siteUrl}`);
  }
}
