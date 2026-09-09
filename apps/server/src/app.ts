import express from 'express';
import { createNotifier } from './notifications.js';
import type { Entry } from './model.js';
import multer from 'multer';
import { optimizePhoto, MAX_PHOTO_BYTES, type PhotoExtension } from './photos.js';
import path from 'node:path';
import { dataDir, publicDir } from './config.js';
import { Store } from './store.js';
import { validateEntry } from './validation.js';
import { checkDate, HttpError } from './model.js';
import { ImageExports, snapshot, streamArchive } from './exports.js';
import { ExportCache } from './export-cache.js';
import { VideoExports } from './video-exports.js';
import { musicBytes, videoMusic, videoSelection } from './video-catalog.js';
import { IdentityStore } from './identity-store.js';
export async function createApp(
  dir = dataDir,
  notify: (entry: Entry) => Promise<void> = createNotifier(),
) {
  const store = new Store(dir);
  await store.init();
  const identities = new IdentityStore(dir);
  await identities.init();
  const cache = new ExportCache(dir, Date.now, store);
  store.onDatesChanged = (dates) => cache.invalidate(dates);
  const exports = new ImageExports(cache);
  const videos = new VideoExports(cache);
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '64kb' }));
  const tokenOf = (req: express.Request) => req.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || req.get('cookie')?.split(';').map((v) => v.trim()).find((v) => v.startsWith('parallel_device='))?.slice('parallel_device='.length);
  const setDevice = (res: express.Response, token: string) => res.cookie('parallel_device', token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 3650 * 86400_000, path: '/' });
  const currentUser = (req: express.Request) => identities.authenticate(tokenOf(req));
  const context = (req: express.Request) => {
    const user = currentUser(req);
    const circleId = req.get('x-circle-id') || (typeof req.query.circleId === 'string' ? req.query.circleId : undefined);
    if (!circleId) throw new HttpError(400, '请选择圈子');
    return { user, circleId, circle: identities.assertMember(circleId, user.id) };
  };
  app.post('/api/identity', async (req, res) => { const result = await identities.createUser(req.body?.nickname, req.body?.avatar); setDevice(res, result.deviceToken); res.status(201).json(result); });
  app.post('/api/identity/recover', async (req, res) => { const result = await identities.recover(req.body?.recoveryCode); setDevice(res, result.deviceToken); res.json(result); });
  app.get('/api/me', (req, res) => { const user = currentUser(req); res.json({ user, circles: identities.circlesFor(user.id) }); });
  app.post('/api/circles', async (req, res) => { const user = currentUser(req); const circle = await identities.createCircle(user.id, req.body?.name, req.body?.inviteCode); await store.claimLegacyEntries(circle.id); res.status(201).json(circle); });
  app.post('/api/circles/join', async (req, res) => { const user = currentUser(req); res.json(await identities.joinCircle(user.id, req.body?.inviteCode)); });
  app.get('/api/circles/:circleId/members', (req, res) => { const user = currentUser(req); res.json(identities.members(req.params.circleId, user.id)); });
  app.put('/api/circles/:circleId/invite-code', async (req, res) => { const user = currentUser(req); await identities.resetInvite(req.params.circleId, user.id, req.body?.inviteCode); res.sendStatus(204); });
  app.delete('/api/circles/:circleId/members/:userId', async (req, res) => { const user = currentUser(req); await identities.removeMember(req.params.circleId, user.id, req.params.userId); res.sendStatus(204); });
  app.delete('/api/circles/:circleId', async (req, res) => { const user = currentUser(req); await identities.deleteCircle(req.params.circleId, user.id); res.sendStatus(204); });
  app.use('/api/exports', async (_req, _res, next) => {
    await cache.cleanup();
    next();
  });
  const parseUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 10, fieldSize: 8192 },
  }).single('photo');
  const upload: express.RequestHandler = (req, res, next) => {
    parseUpload(req, res, (error: unknown) => {
      // Busboy framing errors are plain Errors, not MulterErrors. Keep this
      // mapping here so unrelated application/storage failures remain 500s.
      if (
        error instanceof Error &&
        [
          'Unexpected end of form',
          'Unexpected end of file',
          'Multipart: Boundary not found',
          'Malformed part header',
        ].includes(error.message)
      ) {
        console.warn('[upload] Invalid or incomplete multipart request', {
          method: req.method,
          reason: error.message,
          contentLength: req.get('content-length'),
          complete: req.complete,
        });
        next(new HttpError(400, '上传内容不完整或格式有误，请重新选择照片并重试'));
        return;
      }
      next(error);
    });
  };
  async function saveEntry(req: express.Request, body: Record<string, unknown>, file?: Express.Multer.File, id?: string) {
    const { user, circleId } = context(req);
    const previous = id ? store.find(id) : undefined;
    if (id && (!previous || previous.circleId !== circleId)) throw new HttpError(404, '动态不存在');
    if (previous && previous.personId !== user.id) throw new HttpError(403, '只能修改自己的动态');
    const input = await validateEntry(body, file, { userId: user.id, circleId });
    let bytes = file?.buffer;
    if (file && input.media.type === 'photo') {
      const extension = input.media.filename.split('.').pop() as PhotoExtension;
      const optimized = await optimizePhoto(file.buffer, extension);
      bytes = optimized.bytes;
      input.media.filename = input.media.filename.replace(/\.[^.]+$/, `.${optimized.extension}`);
      input.media.mime = optimized.mime;
    }
    return store.save(input, bytes, id);
  }
  app.get('/api/entry-dates', (req, res) => {
    const { circleId } = context(req);
    const first = checkDate(`${req.query.month}-01`);
    res.json(store.dateCounts(first.slice(0, 7), circleId));
  });
  app.get('/api/entries', (req, res) => { const { circleId } = context(req); res.json(store.list(checkDate(req.query.date), circleId)); });
  app.post('/api/entries', upload, async (req, res) => {
    const entry = await saveEntry(req, req.body || {}, req.file);
    res.status(201).json(entry);
    void Promise.resolve()
      .then(() => notify(entry))
      .catch(() => {
        console.error('[PushPlus] 通知发送失败，动态已保存');
      });
  });
  app.patch('/api/entries/:id', upload, async (req, res) =>
    res.json(await saveEntry(req, req.body || {}, req.file, String(req.params.id))),
  );
  app.delete('/api/entries/:id', async (req, res) => {
    const { user, circleId } = context(req);
    const entry = store.find(req.params.id);
    if (!entry || entry.circleId !== circleId) throw new HttpError(404, '动态不存在');
    if (entry.personId !== user.id) throw new HttpError(403, '只能删除自己的动态');
    await store.delete(req.params.id);
    res.sendStatus(204);
  });
  app.post('/api/exports/images', async (req, res) => {
    const { circleId } = context(req);
    const date = checkDate(req.body?.date);
    const items = await snapshot(store, date, undefined, circleId);
    const result = await exports.generate(items, date);
    cache.assertCurrent(date, items[0].sourceRevision!);
    res.json(result);
  });
  app.post('/api/exports/posts', async (req, res) => {
    const { circleId } = context(req);
    const date = checkDate(req.body?.date);
    const entryId = req.body?.entryId;
    if (typeof entryId !== 'string' || !entryId.trim()) throw new HttpError(400, '请选择动态');
    const items = await snapshot(store, date, entryId, circleId);
    const result = await exports.generate(items, date, true);
    cache.assertCurrent(date, items[0].sourceRevision!);
    res.json(result);
  });
  app.get('/api/exports/video-options', async (req, res) => { context(req); res.json(await videos.options()); });
  app.post('/api/exports/videos', async (req, res) => {
    const { circleId } = context(req);
    const date = checkDate(req.body?.date);
    videoSelection(req.body?.styleId, req.body?.musicId);
    const job = await videos.start(
      await snapshot(store, date, undefined, circleId),
      date,
      req.body.styleId,
      req.body.musicId,
    );
    res.status(job.status === 'ready' ? 200 : 202).json(job);
  });
  app.get('/api/exports/videos/:jobId', async (req, res) =>
    (context(req), res.json(await videos.status(req.params.jobId))),
  );
  app.get('/api/exports/music/:musicId', async (req, res) => {
    context(req);
    const music = videoMusic.find((item) => item.id === req.params.musicId);
    if (!music) throw new HttpError(404, '音乐不存在');
    await musicBytes(music);
    res.sendFile(path.join(publicDir, music.file));
  });
  app.get('/api/exports/archive', async (req, res) => {
    const { circleId } = context(req);
    const date = checkDate(req.query.date);
    const items = await snapshot(store, date, undefined, circleId);
    if (req.query.check === '1') {
      res.json({ count: items.length });
      return;
    }
    await streamArchive(res, items, date);
  });
  app.get('/api/exports/:token/validity', async (req, res) => {
    context(req);
    if (!(await cache.read(req.params.token))) throw new HttpError(404, '导出已过期，请重新生成');
    res.sendStatus(204);
  });
  app.get('/api/exports/files/:token/:name', async (req, res) => {
    context(req);
    const { filename, downloadName, release } = await cache.acquireFile(
      req.params.token,
      req.params.name,
    );
    res.once('finish', release);
    res.once('close', release);
    if (req.query.download === '1') res.attachment(downloadName);
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Export-Filename', encodeURIComponent(downloadName));
    res.sendFile(filename);
  });
  app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在')));
  app.get('/api/uploads/:filename', (req, res) => {
    const { circleId } = context(req);
    const entry = store.findByFilename(req.params.filename);
    if (!entry || entry.circleId !== circleId) throw new HttpError(404, '文件不存在');
    res.sendFile(path.join(store.uploads, req.params.filename));
  });
  app.use(
    express.static(publicDir, {
      maxAge: '30d',
      setHeaders(res, filename) {
        if (path.extname(filename) === '.html') res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );
  app.get('/', (_req, res) =>
    res.sendFile(path.join(publicDir, 'index.html'), {
      headers: { 'Cache-Control': 'no-cache' },
    }),
  );
  app.use(
    (error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.setHeader('Cache-Control', 'no-store');
      res.removeHeader('X-Export-Filename');
      res.removeHeader('ETag');
      res.removeHeader('Last-Modified');
      if (error instanceof multer.MulterError) {
        res.status(400).json({
          error:
            error.code === 'LIMIT_FILE_SIZE' ? '照片不能超过 20 MB' : '上传内容过多，请重新选择',
        });
        return;
      }
      const status =
        error instanceof HttpError ? error.status : (error as { status?: number })?.status || 500;
      if (status >= 500) console.error(error);
      res.status(status).json({
        error:
          error instanceof HttpError
            ? error.message
            : status === 400
              ? '请求内容无法读取'
              : status === 404
                ? '文件不存在'
                : '暂时没能完成，请再试一次',
      });
    },
  );
  return { app, store, identities, dispose: () => cache.dispose() };
}
