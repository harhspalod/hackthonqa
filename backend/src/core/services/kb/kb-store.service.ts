// src/core/services/kb/kb-store.service.ts
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
  site:         string;
  crawled_at:   string;
  pages:        KbPage[];
  api_endpoints: { method: string; path: string; last_status: string }[];
  flows:        KbFlow[];
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
    // https://bharatmcp.com → bharatmcp.com
    return siteUrl
      .replace(/^https?:\/\//, '')
      .replace(/\//g, '_')
      .replace(/[^a-zA-Z0-9._-]/g, '');
  }

  private async ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
  }

  // ── Check if KB exists ──────────────────────────────────────────────────────

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

  // ── Save KB ─────────────────────────────────────────────────────────────────

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
    const metaPath = path.join(folder, 'meta.json');
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));

    this.logger.log(`KB saved for ${siteUrl} — ${tree.pages.length} pages`);
  }

  // ── Load KB ─────────────────────────────────────────────────────────────────

  async loadTree(siteUrl: string): Promise<KbTree | null> {
    const folder   = path.join(this.kbDir, this.siteToFolder(siteUrl));
    const treePath = path.join(folder, 'tree.json');

    try {
      const raw = await fs.readFile(treePath, 'utf-8');
      return JSON.parse(raw) as KbTree;
    } catch {
      this.logger.warn(`KB not found for ${siteUrl}`);
      return null;
    }
  }

  // ── Update a page in KB ─────────────────────────────────────────────────────

  async updatePage(siteUrl: string, page: KbPage): Promise<void> {
    const tree = await this.loadTree(siteUrl);
    if (!tree) return;

    const idx = tree.pages.findIndex(p => p.url === page.url);
    if (idx >= 0) {
      tree.pages[idx] = page;
    } else {
      tree.pages.push(page);
    }

    await this.saveTree(siteUrl, tree);
  }

  // ── Find page matching a signal ─────────────────────────────────────────────

  async findAffectedPage(
    siteUrl:     string,
    signal:      string,
    page?:       string,
  ): Promise<KbPage | null> {
    const tree = await this.loadTree(siteUrl);
    if (!tree) return null;

    // if signal gives exact page → use it
    if (page) {
      const found = tree.pages.find(p => p.url === page);
      if (found) return found;
    }

    // fuzzy match signal text against page urls + known errors
    const lower = signal.toLowerCase();
    return tree.pages.find(p =>
      p.url.toLowerCase().includes(lower)            ||
      p.known_errors.some(e => e.toLowerCase().includes(lower)) ||
      p.elements.some(e => e.toLowerCase().includes(lower))
    ) ?? tree.pages[0] ?? null;
  }

  // ── List all KBs ────────────────────────────────────────────────────────────

  async listAll(): Promise<KbMeta[]> {
    try {
      await this.ensureDir(this.kbDir);
      const folders = await fs.readdir(this.kbDir);
      const metas: KbMeta[] = [];

      for (const folder of folders) {
        const metaPath = path.join(this.kbDir, folder, 'meta.json');
        try {
          const raw = await fs.readFile(metaPath, 'utf-8');
          metas.push(JSON.parse(raw));
        } catch {
          continue;
        }
      }

      return metas;
    } catch {
      return [];
    }
  }

  // ── Delete KB ───────────────────────────────────────────────────────────────

  async deleteKb(siteUrl: string): Promise<void> {
    const folder = path.join(this.kbDir, this.siteToFolder(siteUrl));
    await fs.rm(folder, { recursive: true, force: true });
    this.logger.log(`KB deleted for ${siteUrl}`);
  }
}