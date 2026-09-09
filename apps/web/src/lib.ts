import { people, stickers, type Person } from '@parallel/config';
export { people, stickers, packs } from '@parallel/config';
export type { Person, Sticker } from '@parallel/config';
export type Media =
  | { type: 'photo'; filename: string; mime: string }
  | { type: 'emoji'; emoji: string }
  | { type: 'sticker'; stickerId: string };
export interface Entry {
  id: string;
  circleId?: string;
  personId: string;
  media: Media;
  description: string;
  occurredAt: string;
  createdAt: string;
  updatedAt: string;
}
export interface User { id: string; nickname: string; avatar: string; color: string; background: string }
export interface Circle { id: string; name: string; creatorId: string; createdAt: string; role: 'creator' | 'member'; memberCount: number }
let activeCircleId = localStorage.getItem('parallel.circle') || '';
let activeUserId = '';
export function setActiveIdentity(userId: string, circleId: string) { activeUserId = userId; activeCircleId = circleId; if (circleId) localStorage.setItem('parallel.circle', circleId); }
export const currentUserId = () => activeUserId;
export function setPeople(next: Person[]) { people.splice(0, people.length, ...next); }
export interface ImageExport {
  images: string[];
  expiresAt: string;
}
export const localTime = (iso = new Date().toISOString()) =>
  new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 16);
export const today = () => localTime().slice(0, 10);
export const timeOf = (iso: string) => localTime(iso).slice(11, 16);
export const dateOf = (iso: string) => localTime(iso).slice(0, 10);
export const shiftDate = (date: string, n: number) =>
  new Date(Date.parse(date + 'T00:00:00Z') + n * 86400_000).toISOString().slice(0, 10);
export const personOf = (id: string) =>
  people.find((p) => p.id === id) || {
    id,
    nickname: id,
    color: '#a8977e',
    background: '#f4ede2',
    avatar: '1f431',
  };
export const mediaSrc = (media: Media) =>
  media.type === 'photo'
    ? `/api/uploads/${media.filename}?circleId=${encodeURIComponent(activeCircleId)}`
    : media.type === 'sticker'
      ? stickers.find((s) => s.id === media.stickerId)?.file
      : stickers.find((s) => s.packId === 'fluent' && s.emoji === media.emoji)?.file;
export const mediaName = (media: Media) =>
  media.type === 'photo'
    ? '上传的照片'
    : media.type === 'emoji'
      ? media.emoji
      : stickers.find((s) => s.id === media.stickerId)?.name || '贴纸';
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (activeCircleId) headers.set('x-circle-id', activeCircleId);
  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || '连接有点慢，请再试一次');
  }
  return res.status === 204 ? (undefined as T) : res.json();
}
export function uploadEntry(
  form: FormData,
  id: string | undefined,
  onProgress: (n: number) => void,
): Promise<Entry> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(id ? 'PATCH' : 'POST', id ? `/api/entries/${id}` : '/api/entries');
    if (activeCircleId) xhr.setRequestHeader('x-circle-id', activeCircleId);
    xhr.timeout = 120000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      // Reverse proxies commonly return HTML for size limits and timeouts.
      if (xhr.status === 413) {
        reject(new Error('照片超过服务器上传限制，请缩小照片或联系管理员'));
        return;
      }
      if (xhr.status === 408 || xhr.status === 504) {
        reject(new Error('上传超时了，请检查网络后重试'));
        return;
      }
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error('服务暂时没有回应，请重试'));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || '没能保存，请重试'));
    };
    xhr.onerror = () => reject(new Error('网络连接断开了，内容还在，请重试'));
    xhr.ontimeout = () => reject(new Error('上传超时了，请重试'));
    xhr.send(form);
  });
}
export function readPreference<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}
export function preference(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Preferences are optional. */
  }
}
