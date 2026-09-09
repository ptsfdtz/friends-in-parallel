export type { Person, Sticker, Pack } from '@parallel/config';
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
export interface User {
  id: string;
  nickname: string;
  avatar: string;
  color: string;
  background: string;
}
export interface Circle {
  id: string;
  name: string;
  creatorId: string;
  createdAt: string;
}
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const beijingDate = (iso = new Date().toISOString()) =>
  new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(0, 10);
export const beijingTime = (iso: string) =>
  new Date(new Date(iso).getTime() + 8 * 3600_000).toISOString().slice(11, 16);
export function checkDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new HttpError(400, '请选择有效的日期');
  return value;
}
