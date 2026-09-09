import { Button, Card, Input } from 'animal-island-ui';
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, setActiveIdentity, setPeople, type Circle, type User } from './lib';
interface Session { user: User; circles: Circle[]; circle: Circle; refresh: () => Promise<void>; switchCircle: () => void }
const SessionContext = createContext<Session | null>(null);
export const useSession = () => { const value = useContext(SessionContext); if (!value) throw new Error('Session unavailable'); return value; };
const avatars = ['1f431', '1f43c', '1f438', '1f433', '1f98a', '1f33c'];
export function AccessGate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<{ user: User; circles: Circle[] }>();
  const [circleId, setCircleId] = useState(() => localStorage.getItem('parallel.circle') || '');
  const [mode, setMode] = useState<'identity' | 'recover' | 'circles'>('identity');
  const [nickname, setNickname] = useState(''), [avatar, setAvatar] = useState(avatars[0]);
  const [name, setName] = useState(''), [inviteCode, setInviteCode] = useState('');
  const [recovery, setRecovery] = useState(''), [savedRecovery, setSavedRecovery] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(true);
  const refresh = async () => { const next = await api<{ user: User; circles: Circle[] }>('/api/me'); setMe(next); };
  useEffect(() => { api<{ user: User; circles: Circle[] }>('/api/me').then(async (next) => { setMe(next); setMode('circles'); const saved = localStorage.getItem('parallel.circle') || ''; const valid = next.circles.some((circle) => circle.id === saved) ? saved : ''; setActiveIdentity(next.user.id, valid); setCircleId(valid); setPeople(valid ? await api<User[]>(`/api/circles/${valid}/members`) : [next.user]); }).catch(() => {}).finally(() => setBusy(false)); }, []);
  const choose = async (id: string, state = me) => { if (!state) return; setActiveIdentity(state.user.id, id); setCircleId(id); setPeople(await api<User[]>(`/api/circles/${id}/members`)); };
  async function establish(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (mode === 'recover') await api('/api/identity/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ recoveryCode: recovery }) });
      else { const result = await api<{ recoveryCode: string }>('/api/identity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ nickname, avatar }) }); setSavedRecovery(result.recoveryCode); }
      const next = await api<{ user: User; circles: Circle[] }>('/api/me'); setMe(next); setMode('circles'); setActiveIdentity(next.user.id, ''); setPeople([next.user]);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function circleAction(kind: 'create' | 'join') {
    setBusy(true); setError('');
    try { const circle = await api<Circle>(kind === 'create' ? '/api/circles' : '/api/circles/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(kind === 'create' ? { name, inviteCode } : { inviteCode }) }); const next = await api<{ user: User; circles: Circle[] }>('/api/me'); setMe(next); await choose(circle.id, next); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const active = me?.circles.find((circle) => circle.id === circleId);
  const switchCircle = () => { if (!me) return; setActiveIdentity(me.user.id, ''); setPeople([me.user]); setCircleId(''); };
  if (busy && !me) return <main className="access-shell"><p>正在打开小岛…</p></main>;
  if (active && me) return <SessionContext.Provider value={{ ...me, circle: active, refresh, switchCircle }}>{children}</SessionContext.Provider>;
  return <main className="access-shell"><a className="brand" href="/">和朋友的同一时间</a><Card className="access-card">
    {!me ? <form onSubmit={establish}><h1>{mode === 'recover' ? '恢复我的身份' : '先认识一下你'}</h1>
      {mode === 'identity' ? <><label className="field-label" htmlFor="nickname">昵称</label><Input id="nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} required maxLength={24}/><div className="avatar-options">{avatars.map((item) => <button type="button" key={item} className={avatar === item ? 'selected' : ''} onClick={() => setAvatar(item)}><img src={`/stickers/fluent/${item}.png`} alt=""/></button>)}</div></> : <><label className="field-label" htmlFor="recovery">恢复码</label><Input id="recovery" value={recovery} onChange={(e) => setRecovery(e.target.value)} required/></>}
      {error && <p className="error-banner" role="alert">{error}</p>}<Button type="primary" className="primary full" htmlType="submit" disabled={busy}>{mode === 'recover' ? '恢复身份' : '继续'}</Button><Button type="text" htmlType="button" onClick={() => setMode(mode === 'recover' ? 'identity' : 'recover')}>{mode === 'recover' ? '创建新身份' : '我有恢复码'}</Button>
    </form> : <><h1>{savedRecovery ? '请保存恢复码' : '选择一个圈子'}</h1>{savedRecovery && <div className="recovery-code"><code>{savedRecovery}</code><p>换设备或清理浏览器后，需要它找回身份。此码只显示一次。</p></div>}
      {!!me.circles.length && <div className="circle-list">{me.circles.map((circle) => <button key={circle.id} onClick={() => choose(circle.id)}><strong>{circle.name}</strong><span>{circle.memberCount} 位成员</span></button>)}</div>}
      <label className="field-label" htmlFor="circle-name">圈名（创建时填写）</label><Input id="circle-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="我们的日常"/><label className="field-label" htmlFor="invite-code">邀请暗号</label><Input id="invite-code" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} required/>
      {error && <p className="error-banner" role="alert">{error}</p>}<div className="confirm-actions"><Button type="default" disabled={busy || !inviteCode} onClick={() => circleAction('join')}>加入圈子</Button><Button type="primary" disabled={busy || !name || !inviteCode} onClick={() => circleAction('create')}>创建圈子</Button></div>
    </>}
  </Card></main>;
}
