import { photoExtension, PHOTO_MIMES, MAX_PHOTO_BYTES, type PhotoExtension } from './photos.js';
import { randomUUID } from 'node:crypto';
import { stickerById, emojiSticker } from './config.js';
import { checkDate, HttpError, type Media, type Entry } from './model.js';
export async function validateEntry(
  body: Record<string, unknown>,
  file?: Express.Multer.File,
  identity?: { userId: string; circleId: string },
): Promise<Omit<Entry, 'id' | 'createdAt' | 'updatedAt'>> {
  const { description = '', occurredAt, mediaType } = body;
  if (!identity) throw new HttpError(401, '请先建立身份并进入圈子');
  if (typeof description !== 'string' || Array.from(description).length > 500)
    throw new HttpError(400, '描述请控制在 500 字以内');
  if (
    typeof occurredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(occurredAt) ||
    !Number.isFinite(Date.parse(occurredAt))
  )
    throw new HttpError(400, '请填写有效的时间');
  checkDate(occurredAt.slice(0, 10));
  if (Date.parse(occurredAt) > Date.now())
    throw new HttpError(400, '还没发生的事，等到那一刻再记录吧');
  let media: Media;
  if (mediaType === 'photo') {
    if (file) {
      if (file.buffer.length > MAX_PHOTO_BYTES) throw new HttpError(400, '照片不能超过 20 MB');
      const extension = photoExtension(file.buffer);
      media = {
        type: 'photo',
        filename: `${randomUUID()}.${extension}`,
        mime: PHOTO_MIMES[extension],
      };
    } else {
      if (
        typeof body.filename !== 'string' ||
        !/^[a-f0-9-]+\.(jpg|png|webp|heic|heif)$/.test(body.filename)
      )
        throw new HttpError(400, '请选择照片');
      const extension = body.filename.split('.').pop() as PhotoExtension;
      media = {
        type: 'photo',
        filename: body.filename,
        mime: PHOTO_MIMES[extension],
      };
    }
  } else if (mediaType === 'emoji') {
    if (typeof body.emoji !== 'string' || !emojiSticker(body.emoji))
      throw new HttpError(400, '请选择一个表情');
    media = { type: 'emoji', emoji: body.emoji };
  } else if (mediaType === 'sticker') {
    if (typeof body.stickerId !== 'string' || !stickerById(body.stickerId))
      throw new HttpError(400, '请选择一张贴纸');
    media = { type: 'sticker', stickerId: body.stickerId };
  } else throw new HttpError(400, '请选择照片、表情或贴纸');
  if (file && mediaType !== 'photo') throw new HttpError(400, '每条动态只能选择一种素材');
  return {
    personId: identity.userId,
    circleId: identity.circleId,
    description: description.trim(),
    occurredAt: new Date(occurredAt).toISOString(),
    media,
  };
}
