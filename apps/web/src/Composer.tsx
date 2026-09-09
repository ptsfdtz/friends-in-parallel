import { Input, Icon as IslandIcon, Button, DatePicker, TimePicker } from 'animal-island-ui';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ImagePlus,
  Smile,
  Clock,
  LoaderCircle,
  Camera,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';
import { Modal } from './Modal';
import { Photo } from './Photo';
import { photoPreview } from './photo-preview';
import { readDraft, writeDraft, type Draft } from './drafts';
import {
  people,
  packs,
  stickers,
  personOf,
  mediaSrc,
  localTime,
  readPreference,
  preference,
  uploadEntry,
  currentUserId,
  type Entry,
  type Sticker,
} from './lib';
interface ComposerProps {
  entry?: Entry;
  date: string;
  onClose: () => void;
  onSaved: (entry: Entry) => void;
}
export function Composer(props: ComposerProps) {
  const [loaded, setLoaded] = useState<{ draft?: Draft }>();
  useEffect(() => {
    let active = true;
    if (props.entry) setLoaded({});
    else
      readDraft(props.date).then((draft) => {
        if (active) setLoaded({ draft });
      });
    return () => {
      active = false;
    };
  }, [props.date, props.entry]);
  if (!loaded)
    return (
      <Modal title="冒个泡" onClose={props.onClose}>
        <p className="muted">正在打开草稿…</p>
      </Modal>
    );
  return <ComposerEditor {...props} draft={loaded.draft} />;
}
function ComposerEditor({
  entry,
  date,
  onClose,
  onSaved,
  draft,
}: ComposerProps & { draft?: Draft }) {
  const initialPerson = entry?.personId || currentUserId();
  const [step, setStep] = useState(2), [personId, setPersonId] = useState(initialPerson);
  const [type, setType] = useState<'photo' | 'sticker'>(
    entry ? (entry.media.type === 'photo' ? 'photo' : 'sticker') : draft?.type || 'photo',
  );
  const [description, setDescription] = useState(entry?.description ?? draft?.description ?? ''),
    [time, setTime] = useState(() => {
      if (entry) return localTime(entry.occurredAt);
      // Empty drafts should start at the current time whenever the form reopens.
      const hasContent = draft && (draft.description.trim() || draft.file || draft.stickerId);
      return (hasContent && draft.time) || `${date}T${localTime().slice(11)}`;
    });
  const [pickerOpen, setPickerOpen] = useState(false);
  const filePickerOpen = useRef(false);
  const legacyEmoji = entry?.media.type === 'emoji' ? entry.media.emoji : '';
  const [stickerId, setStickerId] = useState(
    entry?.media.type === 'sticker'
      ? entry.media.stickerId
      : entry?.media.type === 'emoji'
        ? stickers.find((s) => s.packId === 'fluent' && s.emoji === legacyEmoji)?.id || ''
        : draft?.stickerId || '',
  );
  const [pack, setPack] = useState(
    entry?.media.type === 'sticker'
      ? stickers.find((s) => s.id === stickerId)?.packId || 'fluent'
      : 'fluent',
  );
  const [category, setCategory] = useState('全部'),
    [file, setFile] = useState<File | undefined>(draft?.file),
    [preview, setPreview] = useState<{ file: File; url?: string; failed?: boolean }>();
  const [recent, setRecent] = useState<string[]>(readPreference('parallel.recent', []));
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0);
  const [draftStatus, setDraftStatus] = useState('');
  const [undo, setUndo] = useState<{ draft: Draft; clearedTime: string }>();
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(undefined), 10000);
    return () => clearTimeout(timer);
  }, [undo]);
  useEffect(() => {
    if (
      undo &&
      (description ||
        stickerId ||
        file ||
        type !== 'photo' ||
        time !== undo.clearedTime ||
        personId !== undo.draft.personId)
    )
      setUndo(undefined);
  }, [undo, description, stickerId, file, type, time, personId]);
  useEffect(() => {
    if (entry) return;
    let active = true;
    const statusTimer = window.setTimeout(() => {
      if (active) setDraftStatus('正在保存草稿…');
    }, 300);
    void writeDraft(date, { personId, type, description, time, stickerId, file }).then((saved) => {
      if (active) {
        window.clearTimeout(statusTimer);
        setDraftStatus(saved ? '草稿已保存在此设备' : '草稿暂存于当前页面，请勿刷新');
      }
    });
    return () => {
      active = false;
      window.clearTimeout(statusTimer);
    };
  }, [date, entry, personId, type, description, time, stickerId, file]);
  useEffect(() => {
    if (!file) {
      setPreview(undefined);
      return;
    }
    const controller = new AbortController();
    let url: string | undefined;
    setPreview({ file });
    void photoPreview(file, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPreview({ file, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPreview({ file, failed: true });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [file]);
  const choose = (s: Sticker) => {
    setStickerId(s.id);
    setPickerOpen(false);
    const next = [s.id, ...recent.filter((id) => id !== s.id)].slice(0, 18);
    setRecent(next);
    preference('parallel.recent', next);
  };
  const photo = file
    ? preview?.file === file
      ? preview.url
      : ''
    : entry?.media.type === 'photo'
      ? mediaSrc(entry.media)
      : '';
  const filtered = stickers.filter(
    (s) =>
      s.packId === pack &&
      (category === '全部' || category === '最近'
        ? category !== '最近' || recent.includes(s.id)
        : s.category === category),
  );
  const ready = type === 'photo' ? !!file || !!photo : !!stickerId;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!ready) {
      setError('先选择一份素材吧');
      return;
    }
    const parsed = new Date(time + ':00+08:00');
    if (!Number.isFinite(parsed.getTime()) || parsed.getTime() > Date.now()) {
      setError('请选择已经发生的时间');
      return;
    }
    const form = new FormData();
    form.set('description', description);
    form.set('occurredAt', parsed.toISOString());
    form.set('mediaType', type);
    if (type === 'photo') {
      if (file) form.set('photo', file);
      else if (entry?.media.type === 'photo') form.set('filename', entry.media.filename);
    } else if (type === 'sticker') form.set('stickerId', stickerId);
    setBusy(true);
    try {
      const saved = await uploadEntry(form, entry?.id, setProgress);
      preference('parallel.person', personId);
      if (!entry) await writeDraft(date);
      onSaved(saved);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={pickerOpen ? '选择表情' : entry ? '编辑动态' : step === 1 ? '谁来冒个泡？' : '冒个泡'}
      className="composer-modal"
      onClose={onClose}
      busy={busy}
      cancelGuard={filePickerOpen}
    >
      {pickerOpen ? (
        <div className="picker-page">
          <Button
            type="text"
            className="island-control text-button"
            onClick={() => setPickerOpen(false)}
          >
            <IslandIcon icon={ArrowLeft} size={16} />
            返回编辑
          </Button>{' '}
          <div className="sticker-picker">
            <div className="pack-tabs">
              {packs.map((p) => (
                <Button
                  type="text"
                  htmlType="button"
                  key={p.id}
                  className={'island-control ' + (pack === p.id ? 'active' : '')}
                  onClick={() => setPack(p.id)}
                >
                  {p.name}
                </Button>
              ))}
            </div>
            <div className="category-tabs">
              {['全部', '最近', '心情', '吃喝', '工作学习', '休息玩乐'].map((c) => (
                <Button
                  type="text"
                  htmlType="button"
                  className={'island-control ' + (category === c ? 'active' : '')}
                  key={c}
                  onClick={() => setCategory(c)}
                >
                  {c}
                </Button>
              ))}
            </div>
            <div className="sticker-grid">
              {filtered.map((s) => (
                <Button
                  type="text"
                  htmlType="button"
                  key={s.id}
                  className={'island-control ' + (stickerId === s.id ? 'selected' : '')}
                  aria-pressed={stickerId === s.id}
                  onClick={() => choose(s)}
                >
                  <img src={s.file} alt="" loading="lazy" />
                  <span>{s.name}</span>
                  {stickerId === s.id && (
                    <IslandIcon icon={Check} className="sticker-check" size={14} />
                  )}
                </Button>
              ))}
              {!filtered.length && (
                <p className="picker-empty">
                  {category === '最近' ? '这套表情还没有使用记录' : '这个分类还没有表情'}
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          {step === 1 ? (
            <div className="person-step">
              <p className="muted person-intro">选好后，下次会直接为你打开编辑页。</p>
              <div className="person-list" role="group" aria-label="选择人物">
                {people.map((p) => (
                  <Button
                    type="text"
                    key={p.id}
                    aria-pressed={personId === p.id}
                    className={
                      'island-control ' + `person-choice ${personId === p.id ? 'selected' : ''}`
                    }
                    style={
                      {
                        '--person-color': p.color,
                        '--person-bg': p.background,
                      } as React.CSSProperties
                    }
                    onClick={() => setPersonId(p.id)}
                  >
                    <span className="avatar" style={{ background: p.background }}>
                      <img src={`/stickers/fluent/${p.avatar}.png`} alt="" />
                    </span>
                    <span>{p.nickname}</span>
                    <span className="choice-check">
                      {personId === p.id && <IslandIcon icon={Check} size={16} />}
                    </span>
                  </Button>
                ))}
              </div>
              <div className="composer-footer">
                <Button
                  type="primary"
                  className="island-control primary full"
                  disabled={!personId}
                  onClick={() => {
                    preference('parallel.person', personId);
                    setStep(2);
                  }}
                >
                  下一步 <IslandIcon icon={ArrowRight} size={18} />
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={submit}>
              <div className="editor-fields">
                <Button
                  type="text"
                  htmlType="button"
                  className="island-control back-person"
                  disabled
                >
                  <span
                    className="avatar small"
                    style={{ background: personOf(personId).background }}
                  >
                    <img src={`/stickers/fluent/${personOf(personId).avatar}.png`} alt="" />
                  </span>
                  <span className="editor-person-copy">
                    <span>记录的人</span>
                    <strong>{personOf(personId).nickname}</strong>
                  </span>
                  <span className="change-person">身份已确认</span>
                </Button>
                <fieldset disabled={busy} className="editor-sections" aria-label="动态内容">
                  <section className="editor-section">
                    <div className="editor-section-heading">
                      <span className="editor-section-icon">
                        <IslandIcon icon={ImagePlus} size={18} />
                      </span>
                      <div>
                        <h3>今天在干嘛？</h3>
                        <p>照片或表情，选一种记录</p>
                      </div>
                      <span className="field-badge">必选</span>
                    </div>
                    <div className="media-tabs">
                      {(
                        [
                          { id: 'photo', label: '照片', Icon: ImagePlus },
                          { id: 'sticker', label: '表情', Icon: Smile },
                        ] as const
                      ).map(({ id, label, Icon }) => (
                        <Button
                          type="text"
                          key={id}
                          htmlType="button"
                          className={'island-control ' + (type === id ? 'active' : '')}
                          aria-pressed={type === id}
                          onClick={() => {
                            setType(id);
                            setError('');
                          }}
                        >
                          <IslandIcon icon={Icon} size={17} />
                          {label}
                        </Button>
                      ))}
                    </div>
                    {type === 'photo' ? (
                      <label className={`photo-upload ${file || photo ? 'has-photo' : ''}`}>
                        <input
                          type="file"
                          aria-label="上传照片"
                          accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                          onClick={() => {
                            filePickerOpen.current = true;
                          }}
                          onChange={(e) => {
                            filePickerOpen.current = false;
                            const f = e.target.files?.[0];
                            e.target.value = '';
                            if (!f) return;
                            setError('');
                            setFile(f);
                          }}
                        />
                        {file || photo ? (
                          <>
                            {photo ? (
                              <Photo src={photo} alt="照片预览" />
                            ) : (
                              <span className="photo-fallback" role="status">
                                {preview?.file === file && preview?.failed
                                  ? '暂时无法预览，仍可提交由服务器处理'
                                  : '正在生成照片预览…'}
                              </span>
                            )}
                            <span className="replace-photo">
                              <IslandIcon icon={Camera} size={16} /> 换一张照片
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="upload-icon">
                              <IslandIcon icon={ImagePlus} size={28} />
                            </span>
                            <strong>放张照片，让朋友瞅瞅</strong>
                            <small>支持 iPhone 照片 · 最大 20 MB · 上传后自动优化</small>
                          </>
                        )}
                        {file && (
                          <small>
                            {file.name} · {(file.size / 1_000_000).toFixed(2)} MB
                          </small>
                        )}
                      </label>
                    ) : (
                      <Button
                        type="text"
                        htmlType="button"
                        className="island-control selected-media"
                        aria-label={stickerId ? '更换表情' : '选择表情'}
                        onClick={() => setPickerOpen(true)}
                      >
                        {stickerId ? (
                          <img
                            src={stickers.find((s) => s.id === stickerId)?.file}
                            alt={stickers.find((s) => s.id === stickerId)?.name}
                          />
                        ) : (
                          <IslandIcon icon={Smile} size={32} />
                        )}
                        <span>{stickerId ? '更换表情' : '选择表情'}</span>
                      </Button>
                    )}
                  </section>
                  <section className="editor-section">
                    <div className="editor-section-heading">
                      <span className="editor-section-icon">
                        <IslandIcon icon={MessageSquare} size={18} />
                      </span>
                      <div>
                        <h3>
                          <label htmlFor="description">想说的话</label>
                        </h3>
                        <p>给这一刻添几句心情</p>
                      </div>
                      <span className="field-badge optional">选填</span>
                    </div>
                    <div className="description-input">
                      <textarea
                        id="description"
                        placeholder="分享一下正在做的事…"
                        rows={3}
                        maxLength={500}
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                      />
                      <small>{Array.from(description).length}/500</small>
                    </div>
                  </section>
                  <section className="editor-section">
                    <div className="editor-section-heading">
                      <span className="editor-section-icon">
                        <IslandIcon icon={Clock} size={18} />
                      </span>
                      <div>
                        <h3 id="moment-time-label">发生的时间</h3>
                        <p>北京时间 · 也可以补记过去</p>
                      </div>
                    </div>
                    <div className="time-input">
                      <DatePicker
                        className="island-moment-date"
                        value={time.slice(0, 10)}
                        format="YYYY/MM/DD"
                        allowClear={false}
                        showToday
                        disabled={busy}
                        disabledDate={(value) => value.getTime() > Date.now()}
                        aria-labelledby="moment-time-label"
                        onChange={(value) => {
                          if (typeof value !== 'string') return;
                          const next = `${value}T${time.slice(11, 16)}`;
                          setTime(next > localTime() ? localTime() : next);
                        }}
                      />
                      <TimePicker
                        className="island-moment-clock"
                        value={`${time.slice(11, 16)}:00`}
                        format="HH:mm"
                        allowClear={false}
                        minuteStep={1}
                        disabled={busy}
                        aria-label="发生的时刻"
                        onChange={(value) => {
                          if (!value) return;
                          const next = `${time.slice(0, 10)}T${value.slice(0, 5)}`;
                          setTime(next > localTime() ? localTime() : next);
                        }}
                      />
                      <Button
                        className="island-control"
                        type="text"
                        htmlType="button"
                        onClick={() => setTime(localTime())}
                      >
                        现在
                      </Button>
                    </div>
                  </section>
                </fieldset>
                {error && (
                  <p role="alert" className="error-banner">
                    {error}
                  </p>
                )}
              </div>
              <div className="composer-footer">
                {!entry && (
                  <div className="draft-note">
                    <span role="status">{undo ? '草稿已清空 · 10 秒内可撤销' : draftStatus}</span>
                    {undo ? (
                      <Button
                        className="island-control"
                        type="text"
                        htmlType="button"
                        disabled={busy}
                        onClick={() => {
                          const previous = undo.draft;
                          setPersonId(previous.personId);
                          setDescription(previous.description);
                          setStickerId(previous.stickerId);
                          setFile(previous.file);
                          setType(previous.type);
                          setTime(previous.time);
                          setError('');
                          setUndo(undefined);
                        }}
                      >
                        撤销清空
                      </Button>
                    ) : (
                      <Button
                        className="island-control"
                        type="text"
                        htmlType="button"
                        disabled={busy || (!description && !stickerId && !file)}
                        onClick={() => {
                          const clearedTime = `${date}T${localTime().slice(11)}`;
                          setUndo({
                            draft: { personId, description, stickerId, file, type, time },
                            clearedTime,
                          });
                          setDescription('');
                          setStickerId('');
                          setFile(undefined);
                          setType('photo');
                          setTime(clearedTime);
                          setError('');
                        }}
                      >
                        清空草稿
                      </Button>
                    )}
                  </div>
                )}
                <Button
                  type="primary"
                  className="island-control primary full"
                  disabled={busy || !ready}
                  htmlType="submit"
                >
                  {busy ? (
                    <>
                      <IslandIcon icon={LoaderCircle} className="spin" size={18} />
                      {progress < 100 ? `正在上传 ${progress}%` : '正在优化并保存…'}
                    </>
                  ) : (
                    <>
                      {entry ? '保存修改' : '发布'}
                      <IslandIcon icon={ArrowRight} size={18} />
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
