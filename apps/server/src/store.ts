import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import type { Entry } from './model.js';
import { beijingDate, HttpError } from './model.js';
export class Store {
  private entries: Entry[] = [];
  private revisions: Record<string, string> = {};
  onDatesChanged: (dates: string[]) => void = () => {};
  revision(date: string, circleId = '') {
    return this.revisions[`${circleId}:${date}`] || this.revisions[date] || 'empty';
  }
  private tail: Promise<unknown> = Promise.resolve();
  readonly uploads: string;
  constructor(readonly dir: string) {
    this.uploads = path.join(dir, 'uploads');
  }
  async init() {
    await mkdir(this.uploads, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(path.join(this.dir, 'entries.json'), 'utf8'));
      if (Array.isArray(parsed)) {
        this.entries = parsed;
        // Stable until the first write migrates this legacy array, including across restarts.
        for (const date of new Set(parsed.map((entry: Entry) => beijingDate(entry.occurredAt)))) {
          this.revisions[date] =
            'legacy:' +
            createHash('sha256')
              .update(JSON.stringify(this.list(date)))
              .digest('hex');
        }
      } else if (
        parsed?.version === 1 &&
        Array.isArray(parsed.entries) &&
        parsed.revisions &&
        typeof parsed.revisions === 'object' &&
        !Array.isArray(parsed.revisions) &&
        Object.values(parsed.revisions).every((value) => typeof value === 'string')
      ) {
        this.entries = parsed.entries;
        this.revisions = parsed.revisions;
      } else throw new Error('Invalid entries.json');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn);
    this.tail = result.catch(() => {});
    return result;
  }
  list(date: string, circleId?: string) {
    return structuredClone(
      this.entries
        .filter((e) => beijingDate(e.occurredAt) === date && (!circleId || e.circleId === circleId))
        .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id)),
    );
  }
  dateCounts(month: string, circleId?: string) {
    const counts: Record<string, number> = {};
    for (const entry of this.entries) {
      const date = beijingDate(entry.occurredAt);
      if (date.startsWith(month + '-') && (!circleId || entry.circleId === circleId)) counts[date] = (counts[date] || 0) + 1;
    }
    return counts;
  }
  private async persist(next: Entry[], dates: string[], circleId = '') {
    const revisions = { ...this.revisions };
    for (const date of new Set(dates)) {
      const revision = randomUUID();
      revisions[date] = revision;
      revisions[`${circleId}:${date}`] = revision;
    }
    const tmp = path.join(this.dir, `entries.${randomUUID()}.tmp`);
    try {
      await writeFile(
        tmp,
        JSON.stringify({ version: 1, entries: next, revisions }, null, 2) + '\n',
      );
      await rename(tmp, path.join(this.dir, 'entries.json'));
      this.entries = next;
      this.revisions = revisions;
      this.onDatesChanged([...new Set(dates)]);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
  async save(input: Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>, photo?: Buffer, id?: string) {
    return this.exclusive(async () => {
      const previous = id ? this.entries.find((e) => e.id === id) : undefined;
      if (id && !previous) throw new HttpError(404, '这条动态已经不在了');
      // Retained photos must belong to the record being edited.
      if (
        input.media.type === 'photo' &&
        !photo &&
        (previous?.media.type !== 'photo' || previous.media.filename !== input.media.filename)
      )
        throw new HttpError(400, '请重新选择照片');
      const now = new Date().toISOString();
      const entry: Entry = {
        ...input,
        id: id || randomUUID(),
        createdAt: previous?.createdAt || now,
        updatedAt: now,
      };
      let added: string | undefined;
      if (photo && input.media.type === 'photo') {
        added = path.join(this.uploads, input.media.filename);
        await writeFile(added, photo, { flag: 'wx' });
      }
      try {
        await this.persist(
          previous ? this.entries.map((e) => (e.id === id ? entry : e)) : [...this.entries, entry],
          [beijingDate(entry.occurredAt), ...(previous ? [beijingDate(previous.occurredAt)] : [])], entry.circleId,
        );
      } catch (e) {
        if (added) await unlink(added).catch(() => {});
        throw e;
      }
      if (
        previous?.media.type === 'photo' &&
        (input.media.type !== 'photo' || previous.media.filename !== input.media.filename)
      )
        await unlink(path.join(this.uploads, previous.media.filename)).catch(() => {});
      return structuredClone(entry);
    });
  }
  find(id: string) { return this.entries.find((entry) => entry.id === id); }
  findByFilename(filename: string) { return this.entries.find((entry) => entry.media.type === 'photo' && entry.media.filename === filename); }
  async claimLegacyEntries(circleId: string) {
    const legacy = this.entries.filter((entry) => !entry.circleId);
    if (!legacy.length) return;
    await this.exclusive(async () => {
      const dates = legacy.map((entry) => beijingDate(entry.occurredAt));
      await this.persist(this.entries.map((entry) => entry.circleId ? entry : { ...entry, circleId }), dates, circleId);
    });
  }
  async delete(id: string) {
    return this.exclusive(async () => {
      const entry = this.entries.find((e) => e.id === id);
      if (!entry) throw new HttpError(404, '这条动态已经不在了');
      await this.persist(
        this.entries.filter((e) => e.id !== id),
        [beijingDate(entry.occurredAt)], entry.circleId,
      );
      if (entry.media.type === 'photo')
        await unlink(path.join(this.uploads, entry.media.filename)).catch(() => {});
    });
  }
}
