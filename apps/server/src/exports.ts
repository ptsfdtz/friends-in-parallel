import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import archiver from 'archiver';
import { chromium } from 'playwright';
import {
  imageBlocks,
  imageTemplate,
  loadImageScene,
  measureImageScene,
  postTemplate,
} from './image-layout.js';
import type { Response } from 'express';
import { publicDir, packs, personById, stickerById, emojiSticker } from './config.js';
import { beijingTime, HttpError, type Entry, type Person } from './model.js';
import type { Store } from './store.js';
import { ExportCache, contentFingerprint, type CacheWork } from './export-cache.js';
export function exportFilename(date: string, kind: 'materials' | 'image', page = 1) {
  const label = kind === 'materials' ? '素材包' : `手账-${String(page).padStart(2, '0')}`;
  return `和朋友的同一时间-${date}-${label}.${kind === 'image' ? 'png' : 'zip'}`;
}
export interface SnapshotItem {
  sourceRevision?: string;
  entry: Entry;
  person: Person;
  bytes: Buffer;
  mime: string;
  extension: string;
  filename: string;
  credit: string;
}
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export async function snapshot(
  store: Store,
  date: string,
  entryId?: string,
  circleId?: string,
): Promise<SnapshotItem[]> {
  return store.exclusive(async () => {
    const entries = store
      .list(date, circleId)
      .filter((entry) => entryId === undefined || entry.id === entryId);
    if (entryId !== undefined && !entries.length) throw new HttpError(404, '动态不存在');
    if (!entries.length) throw new HttpError(400, '这一天还没动态，先冒个泡吧');
    entries.sort(
      (a, b) =>
        a.occurredAt.localeCompare(b.occurredAt) ||
        a.createdAt.localeCompare(b.createdAt) ||
        a.id.localeCompare(b.id),
    );
    return Promise.all(
      entries.map(async (entry) => {
        const person = personById(entry.personId) || {
          id: entry.personId,
          nickname: entry.personId,
          color: '#a8977e',
          background: '#f4ede2',
          avatar: '1f431',
        };
        const s =
          entry.media.type === 'sticker'
            ? stickerById(entry.media.stickerId)
            : entry.media.type === 'emoji'
              ? emojiSticker(entry.media.emoji)
              : undefined;
        if (entry.media.type !== 'photo' && !s)
          throw new HttpError(409, '某张贴纸配置缺失，请恢复素材后重试');
        const file =
          entry.media.type === 'photo'
            ? path.join(store.uploads, entry.media.filename)
            : path.join(publicDir, s!.file);
        let bytes: Buffer;
        try {
          bytes = await readFile(file);
        } catch {
          throw new HttpError(409, `${person.nickname}的一份素材缺失，请检查后重试`);
        }
        const extension = path.extname(file).slice(1);
        const mime =
          entry.media.type === 'photo'
            ? entry.media.mime
            : extension === 'svg'
              ? 'image/svg+xml'
              : extension === 'jpg'
                ? 'image/jpeg'
                : `image/${extension}`;
        const pack = s ? packs.find((p) => p.id === s.packId) : undefined;
        return {
          sourceRevision: store.revision(date),
          entry,
          person,
          bytes,
          mime,
          extension,
          filename: `${entry.personId}/${date}-${beijingTime(entry.occurredAt).replace(':', '-')}-${entry.id}.${extension}`,
          credit: pack ? `${pack.brand} · ${pack.license}` : '',
        };
      }),
    );
  });
}
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function streamArchive(res: Response, items: SnapshotItem[], date: string) {
  // Load all supporting files before sending headers, so missing assets produce a clear error.
  const licenses = await Promise.all(
    (await readdir(path.join(publicDir, 'licenses'))).map(async (name) => ({
      name,
      bytes: await readFile(path.join(publicDir, 'licenses', name)),
    })),
  );
  const manifest = items.map(({ entry, person, filename, credit }) => ({
    id: entry.id,
    personId: entry.personId,
    nickname: person.nickname,
    occurredAt: entry.occurredAt,
    beijingTime: `${date} ${beijingTime(entry.occurredAt)} +08:00`,
    description: entry.description,
    mediaType: entry.media.type,
    media: entry.media,
    path: filename,
    credit,
  }));
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', () => res.destroy());
  archive.on('warning', () => res.destroy());
  res.attachment(exportFilename(date, 'materials'));
  archive.pipe(res);
  res.on('close', () => {
    if (!res.writableFinished) archive.abort();
  });
  for (const item of items) archive.append(item.bytes, { name: item.filename });
  archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });
  const headers = [
    'id',
    'personId',
    'nickname',
    'occurredAt',
    'beijingTime',
    'description',
    'mediaType',
    'path',
    'credit',
  ] as const;
  archive.append(
    '\ufeff' +
      [
        headers.join(','),
        ...manifest.map((row) => headers.map((key) => csvCell(row[key])).join(',')),
      ].join('\r\n'),
    { name: 'manifest.csv' },
  );
  for (const license of licenses)
    archive.append(license.bytes, { name: `licenses/${license.name}` });
  await archive.finalize();
}
export function partitionHeights(heights: number[], available = 11500) {
  const groups: number[][] = [];
  let current: number[] = [];
  let used = 0;
  heights.forEach((h, i) => {
    if (current.length && used + h > available) {
      groups.push(current);
      current = [];
      used = 0;
    }
    current.push(i);
    used += h;
  });
  if (current.length) groups.push(current);
  return groups;
}
interface ImageExportResult {
  images: string[];
  expiresAt: string;
}
const exportResult = (token: string, pages: number, expiresAt: string): ImageExportResult => ({
  images: Array.from({ length: pages }, (_, i) => `/api/exports/files/${token}/${i + 1}.png`),
  expiresAt,
});
export class ImageExports {
  readonly cache: ExportCache;
  readonly dir: string;
  constructor(dataDir: string | ExportCache) {
    this.cache = typeof dataDir === 'string' ? new ExportCache(dataDir) : dataDir;
    this.dir = this.cache.dir;
  }
  cleanup() {
    return this.cache.cleanup();
  }
  async generate(items: SnapshotItem[], date: string, post = false): Promise<ImageExportResult> {
    const [font, renderer, cacheRenderer, layoutSources] = await Promise.all([
      readFile(path.join(publicDir, 'fonts/NotoSansCJKsc-Regular.otf')),
      readFile(new URL(import.meta.url)),
      readFile(
        new URL(
          `./export-cache${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`,
          import.meta.url,
        ),
      ),
      Promise.all(
        ['image-layout', 'collage-layout'].map((name) =>
          readFile(
            new URL(`./${name}${import.meta.url.endsWith('.ts') ? '.ts' : '.js'}`, import.meta.url),
          ),
        ),
      ),
    ]);
    const key = contentFingerprint(items, [
      post ? 'post' : 'images',
      date,
      renderer,
      cacheRenderer,
      ...layoutSources,
      font,
    ]);
    const revision = items[0]?.sourceRevision || 'standalone';
    return this.cache.singleFlight(key, async () => {
      this.cache.assertCurrent(date, revision);
      const cached = await this.cache.find<ImageExportResult>(key, 'images');
      if (cached) return cached.result;
      const work = this.cache.reserve(120_000, date, revision);
      const job = this.render(items, date, key, font, work, post);
      this.cache.track(work, job);
      return job;
    });
  }
  private async render(
    items: SnapshotItem[],
    date: string,
    key: string,
    font: Buffer,
    work: CacheWork,
    post: boolean,
  ) {
    const { token, dir: dest } = work;
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await mkdir(dest, { recursive: true });
      work.signal.throwIfAborted();
      browser = await chromium.launch({ headless: true, timeout: 30_000 });
      const close = () => {
        void browser?.close().catch(() => {});
      };
      work.signal.addEventListener('abort', close, { once: true });
      if (work.signal.aborted) {
        close();
        work.signal.throwIfAborted();
      }
      timer = setTimeout(() => {
        void browser?.close().catch(() => {});
      }, 90_000);
      const page = await browser.newPage({
        viewport: { width: 1080, height: 1000 },
        deviceScaleFactor: 1,
      });
      page.setDefaultTimeout(30_000);
      await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== 'http://render.local') return route.abort();
        if (url.pathname === '/font.otf')
          return route.fulfill({
            body: font,
            contentType: 'font/otf',
            headers: { 'Access-Control-Allow-Origin': '*' },
          });
        const match = url.pathname.match(/^\/image\/(\d+)$/),
          item = match ? items[Number(match[1])] : undefined;
        if (item) return route.fulfill({ body: item.bytes, contentType: item.mime });
        return route.abort();
      });
      const names: Record<string, string> = {};
      let pages = 1;
      if (post) {
        await loadImageScene(page, postTemplate(items[0], date));
        await page
          .locator('.sheet')
          .screenshot({ path: path.join(dest, '1.png'), timeout: 30_000 });
        names['1.png'] = `和朋友的同一时间-${date}-动态.png`;
      } else {
        const { blocks, pages: groups } = await imageBlocks(page, items, date);
        pages = groups.length;
        for (let i = 0; i < groups.length; i++) {
          await loadImageScene(
            page,
            imageTemplate(items, blocks, groups[i], date, i + 1, groups.length),
          );
          const measured = await measureImageScene(page);
          if (!measured.fits || measured.height > 12000)
            throw new Error('Image layout exceeds safe area');
          await page
            .locator('.sheet')
            .screenshot({ path: path.join(dest, `${i + 1}.png`), timeout: 30_000 });
          names[`${i + 1}.png`] = exportFilename(date, 'image', i + 1);
        }
      }
      return await this.cache.publish(work, 'images', key, date, names, (expiresAt) =>
        exportResult(token, pages, expiresAt),
      );
    } catch (e) {
      if (work.signal.aborted && work.signal.reason instanceof HttpError) throw work.signal.reason;
      if (e instanceof HttpError) throw e;
      console.error('Image export failed:', e);
      throw new HttpError(500, '长图生成失败，请确认服务端 Chromium 已安装后重试');
    } finally {
      if (timer) clearTimeout(timer);
      await browser?.close().catch(() => {});
      await this.cache.finish(work);
    }
  }
  file(token: string, name: string) {
    return this.cache.file(token, name);
  }
}
