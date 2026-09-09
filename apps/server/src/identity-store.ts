import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, type Circle, type User } from './model.js';

interface PrivateUser extends User { deviceTokenHash: string; recoveryCodeHash: string }
interface PrivateCircle extends Circle { inviteCodeHash: string }
interface State { version: 1; users: PrivateUser[]; circles: PrivateCircle[]; members: { circleId: string; userId: string; joinedAt: string }[] }
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = (bytes = 24) => randomBytes(bytes).toString('base64url');
const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const publicUser = ({ deviceTokenHash: _d, recoveryCodeHash: _r, ...user }: PrivateUser): User => user;
const publicCircle = ({ inviteCodeHash: _i, ...circle }: PrivateCircle): Circle => circle;

export class IdentityStore {
  private state: State = { version: 1, users: [], circles: [], members: [] };
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private dir: string) {}
  async init() {
    await mkdir(this.dir, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(path.join(this.dir, 'identity.json'), 'utf8'));
      if (parsed?.version !== 1 || !Array.isArray(parsed.users) || !Array.isArray(parsed.circles) || !Array.isArray(parsed.members)) throw new Error('Invalid identity.json');
      this.state = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  private async update<T>(fn: () => T) {
    const work = this.tail.then(async () => {
      const result = fn();
      const tmp = path.join(this.dir, `identity.${randomUUID()}.tmp`);
      try { await writeFile(tmp, JSON.stringify(this.state, null, 2) + '\n'); await rename(tmp, path.join(this.dir, 'identity.json')); }
      finally { await unlink(tmp).catch(() => {}); }
      return result;
    });
    this.tail = work.catch(() => {});
    return work;
  }
  authenticate(token: string | undefined) {
    if (!token) throw new HttpError(401, '请先在这台设备上建立身份');
    const tokenHash = hash(token);
    const user = this.state.users.find((item) => same(item.deviceTokenHash, tokenHash));
    if (!user) throw new HttpError(401, '设备身份已失效，请使用恢复码恢复');
    return publicUser(user);
  }
  async createUser(nickname: unknown, avatar: unknown) {
    const name = typeof nickname === 'string' ? nickname.trim() : '';
    if (!name || Array.from(name).length > 24) throw new HttpError(400, '昵称请控制在 1–24 个字以内');
    if (typeof avatar !== 'string' || !/^[a-z0-9-]{1,40}$/.test(avatar)) throw new HttpError(400, '请选择头像');
    const deviceToken = secret(), recoveryCode = secret(12);
    const user: PrivateUser = { id: randomUUID(), nickname: name, avatar, color: '#9a7655', background: '#f3e4cd', deviceTokenHash: hash(deviceToken), recoveryCodeHash: hash(recoveryCode) };
    await this.update(() => this.state.users.push(user));
    return { user: publicUser(user), deviceToken, recoveryCode };
  }
  async recover(recoveryCode: unknown) {
    if (typeof recoveryCode !== 'string') throw new HttpError(400, '请输入恢复码');
    const codeHash = hash(recoveryCode.trim());
    const user = this.state.users.find((item) => same(item.recoveryCodeHash, codeHash));
    if (!user) throw new HttpError(401, '恢复码无效');
    const deviceToken = secret();
    await this.update(() => { user.deviceTokenHash = hash(deviceToken); });
    return { user: publicUser(user), deviceToken };
  }
  circlesFor(userId: string) {
    const ids = new Set(this.state.members.filter((m) => m.userId === userId).map((m) => m.circleId));
    return this.state.circles.filter((c) => ids.has(c.id)).map((c) => ({ ...publicCircle(c), role: c.creatorId === userId ? 'creator' as const : 'member' as const, memberCount: this.state.members.filter((m) => m.circleId === c.id).length }));
  }
  assertMember(circleId: string, userId: string) {
    const circle = this.state.circles.find((c) => c.id === circleId);
    if (!circle || !this.state.members.some((m) => m.circleId === circleId && m.userId === userId)) throw new HttpError(403, '你已不在这个圈子中');
    return circle;
  }
  members(circleId: string, userId: string) {
    const circle = this.assertMember(circleId, userId);
    return this.state.members.filter((m) => m.circleId === circleId).map((m) => ({ ...publicUser(this.state.users.find((u) => u.id === m.userId)!), joinedAt: m.joinedAt, role: circle.creatorId === m.userId ? 'creator' as const : 'member' as const }));
  }
  async createCircle(userId: string, name: unknown, inviteCode: unknown) {
    const title = typeof name === 'string' ? name.trim() : '';
    const code = typeof inviteCode === 'string' ? inviteCode.trim() : '';
    if (!title || Array.from(title).length > 40) throw new HttpError(400, '圈名请控制在 1–40 个字以内');
    if (code.length < 4 || Array.from(code).length > 40) throw new HttpError(400, '邀请暗号需要 4–40 个字符');
    const circle: PrivateCircle = { id: randomUUID(), name: title, creatorId: userId, createdAt: new Date().toISOString(), inviteCodeHash: hash(code) };
    await this.update(() => { this.state.circles.push(circle); this.state.members.push({ circleId: circle.id, userId, joinedAt: circle.createdAt }); });
    return publicCircle(circle);
  }
  async joinCircle(userId: string, inviteCode: unknown) {
    if (typeof inviteCode !== 'string') throw new HttpError(400, '请输入邀请暗号');
    const codeHash = hash(inviteCode.trim());
    const circle = this.state.circles.find((c) => same(c.inviteCodeHash, codeHash));
    if (!circle) throw new HttpError(404, '没有找到使用这个暗号的圈子');
    await this.update(() => { if (!this.state.members.some((m) => m.circleId === circle.id && m.userId === userId)) this.state.members.push({ circleId: circle.id, userId, joinedAt: new Date().toISOString() }); });
    return publicCircle(circle);
  }
  async resetInvite(circleId: string, userId: string, inviteCode: unknown) {
    const circle = this.assertMember(circleId, userId);
    if (circle.creatorId !== userId) throw new HttpError(403, '只有创建者可以重置邀请暗号');
    const code = typeof inviteCode === 'string' ? inviteCode.trim() : '';
    if (code.length < 4 || Array.from(code).length > 40) throw new HttpError(400, '邀请暗号需要 4–40 个字符');
    await this.update(() => { circle.inviteCodeHash = hash(code); });
  }
  async removeMember(circleId: string, actorId: string, memberId: string) {
    const circle = this.assertMember(circleId, actorId);
    if (circle.creatorId !== actorId) throw new HttpError(403, '只有创建者可以移除成员');
    if (memberId === actorId) throw new HttpError(400, '创建者不能移除自己');
    await this.update(() => { this.state.members = this.state.members.filter((m) => m.circleId !== circleId || m.userId !== memberId); });
  }
  async deleteCircle(circleId: string, userId: string) {
    const circle = this.assertMember(circleId, userId);
    if (circle.creatorId !== userId) throw new HttpError(403, '只有创建者可以解散圈子');
    await this.update(() => { this.state.circles = this.state.circles.filter((c) => c.id !== circleId); this.state.members = this.state.members.filter((m) => m.circleId !== circleId); });
  }
  user(userId: string) { const user = this.state.users.find((u) => u.id === userId); return user ? publicUser(user) : undefined; }
}
