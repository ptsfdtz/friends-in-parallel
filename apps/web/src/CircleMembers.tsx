import { Button, Input } from 'animal-island-ui';
import { useEffect, useState } from 'react';
import { api, type User } from './lib';
import { Modal } from './Modal';
import { useSession } from './AccessGate';
type Member = User & { role: 'creator' | 'member'; joinedAt: string };
export function CircleMembers({ onClose }: { onClose: () => void }) {
  const { circle, user, refresh, switchCircle } = useSession();
  const [members, setMembers] = useState<Member[]>([]), [code, setCode] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const load = () => api<Member[]>(`/api/circles/${circle.id}/members`).then(setMembers).catch((e) => setError(e.message));
  useEffect(() => { void load(); }, [circle.id]);
  async function remove(member: Member) { setBusy(true); setError(''); try { await api(`/api/circles/${circle.id}/members/${member.id}`, { method: 'DELETE' }); await load(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function reset() { setBusy(true); setError(''); try { await api(`/api/circles/${circle.id}/invite-code`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ inviteCode: code }) }); setCode(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  async function dissolve() { if (!confirm(`确定解散“${circle.name}”吗？圈子将立即无法访问。`)) return; setBusy(true); try { await api(`/api/circles/${circle.id}`, { method: 'DELETE' }); localStorage.removeItem('parallel.circle'); await refresh(); onClose(); location.reload(); } catch (e) { setError((e as Error).message); setBusy(false); } }
  const creator = circle.creatorId === user.id;
  return <Modal title={`${circle.name}的成员`} onClose={onClose} busy={busy}><Button type="default" className="switch-circle-action" onClick={() => { onClose(); switchCircle(); }}>切换圈子</Button><div className="member-list">{members.map((member) => <div className="member-row" key={member.id}><span className="avatar small" style={{ background: member.background }}><img src={`/stickers/fluent/${member.avatar}.png`} alt=""/></span><strong>{member.nickname}</strong><span>{member.role === 'creator' ? '创建者' : '成员'}</span>{creator && member.id !== user.id && <Button type="text" danger disabled={busy} onClick={() => remove(member)}>移除</Button>}</div>)}</div>
    {creator && <section className="member-admin"><label className="field-label" htmlFor="new-invite">重置邀请暗号</label><div className="inline-form"><Input id="new-invite" value={code} onChange={(e) => setCode(e.target.value)} placeholder="至少 4 个字符"/><Button type="default" disabled={busy || code.length < 4} onClick={reset}>保存</Button></div><Button type="default" danger disabled={busy} onClick={dissolve}>解散圈子</Button></section>}{error && <p className="error-banner" role="alert">{error}</p>}</Modal>;
}
