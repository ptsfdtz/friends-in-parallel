import { Icon as IslandIcon, Button } from 'animal-island-ui';
import { useEffect, useRef, useState } from 'react';
import { Plus, Check, LoaderCircle, Clapperboard, CalendarDays, ArrowUp, Users } from 'lucide-react';
import { DateCalendar } from './DateCalendar';
import { Composer } from './Composer';
import { Timeline } from './Timeline';
import { ExportDialog } from './ExportDialog';
import { videoMusic } from '@parallel/config';
import { Modal } from './Modal';
import { usePullToRefresh } from './usePullToRefresh';
import { api, today, dateOf, type Entry } from './lib';
import { CircleMembers } from './CircleMembers';
export default function App() {
  const [date, setDate] = useState(today());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const calendarTrigger = useRef<HTMLButtonElement>(null);
  function closeCalendar() {
    setCalendarOpen(false);
    requestAnimationFrame(() => calendarTrigger.current?.focus({ preventScroll: true }));
  }
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loadedDate, setLoadedDate] = useState('');
  const initialLoading = loadedDate !== date;
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const pull = usePullToRefresh(loading, () => setRevision((n) => n + 1));
  const [composer, setComposer] = useState<{ entry?: Entry } | null>(null),
    [exportOpen, setExportOpen] = useState(false),
    [deleteEntry, setDeleteEntry] = useState<Entry>(),
    [deleting, setDeleting] = useState(false),
    [deleteError, setDeleteError] = useState('');
  const [toast, setToast] = useState(''),
    [focusId, setFocusId] = useState(''),
    [credits, setCredits] = useState(false), [membersOpen, setMembersOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');

    api<Entry[]>(`/api/entries?date=${date}`, { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setEntries(value);
        setLoadedDate(date);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [date, revision]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!focusId || loading) return;
    const id = setTimeout(() => {
      document
        .getElementById(`entry-${focusId}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Consume the save target so later refreshes don't scroll to it again.
      setFocusId('');
    }, 150);
    return () => clearTimeout(id);
  }, [focusId, entries, loading]);
  function saved(entry: Entry) {
    setExportOpen(false);
    setComposer(null);
    setDate(dateOf(entry.occurredAt));
    setFocusId(entry.id);
    setRevision((n) => n + 1);
    setToast(composer?.entry ? '修改已保存' : '冒泡成功，朋友们看得到啦');
  }
  async function remove() {
    if (!deleteEntry) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await api(`/api/entries/${deleteEntry.id}`, { method: 'DELETE' });
      setExportOpen(false);
      setDeleteEntry(undefined);
      setRevision((n) => n + 1);
      setToast('这条动态已删除');
    } catch (e) {
      setDeleteError((e as Error).message);
    } finally {
      setDeleting(false);
    }
  }
  return (
    <>
      <main className="app-shell" ref={pull.surface}>
        <div
          className={`pull-refresh ${pull.distance ? 'pulling' : ''} ${pull.ready ? 'ready' : ''}`}
          style={{ height: pull.distance }}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {pull.distance > 0 && (
            <span>
              <IslandIcon icon={ArrowUp} size={20} />
              {pull.ready ? '松开刷新' : '下拉刷新'}
            </span>
          )}
        </div>
        <header className="brand-header">
          <div className="brand-copy">
            <h1>
              <a className="brand" href="/" aria-label="和朋友的同一时间首页">
                和朋友的同一时间
              </a>
            </h1>
            <p>同一时间，看看朋友们都在干嘛。</p>
          </div>
          <div className="header-actions">
            <button type="button" className="date-picker compact-date-picker" onClick={() => setMembersOpen(true)} aria-label="成员列表"><span><IslandIcon icon={Users} size={16}/><strong>成员</strong></span></button>
            <button
              ref={calendarTrigger}
              type="button"
              className="date-picker compact-date-picker"
              title={date}
              aria-label="选择日期"
              aria-haspopup="dialog"
              aria-expanded={calendarOpen}
              onClick={() => setCalendarOpen(true)}
            >
              <span>
                <IslandIcon icon={CalendarDays} size={16} />
                <strong>
                  {date === today()
                    ? '今天'
                    : (date.slice(0, 4) === today().slice(0, 4) ? date.slice(5) : date).replaceAll(
                        '-',
                        '/',
                      )}
                </strong>
              </span>
            </button>
          </div>
        </header>
        <Timeline
          entries={loadedDate === date ? entries : []}
          loading={initialLoading && !error}
          error={error}
          onRefresh={() => setRevision((n) => n + 1)}
          onEdit={(entry) => setComposer({ entry })}
          onDelete={(entry) => {
            setDeleteError('');
            setDeleteEntry(entry);
          }}
          date={date}
          focusId={focusId}
        />
        <footer className="app-footer">
          <Button className="island-control" type="text" onClick={() => setCredits(true)}>
            素材鸣谢
          </Button>
        </footer>
      </main>
      <div className="floating-actions">
        <Button
          type="primary"
          className="island-control floating-create"
          aria-label={date === today() ? '冒个泡' : '补个泡'}
          onClick={() => setComposer({})}
        >
          <IslandIcon icon={Plus} size={20} />
          {date === today() ? '冒个泡' : '补个泡'}
        </Button>
        <Button
          type="primary"
          className="island-control export-trigger"
          aria-label="制作回忆"
          title="手账长图 · 回忆视频 · 素材导出"
          onClick={() => setExportOpen(true)}
          disabled={!entries.length || loading || !!error}
        >
          <IslandIcon icon={Clapperboard} size={20} />
          <span>制作回忆</span>
        </Button>
      </div>
      {calendarOpen && (
        <DateCalendar
          date={date}
          onClose={closeCalendar}
          onSelect={(next) => {
            setDate(next);
            closeCalendar();
          }}
        />
      )}
      {composer && (
        <Composer
          date={date}
          entry={composer.entry}
          onClose={() => setComposer(null)}
          onSaved={saved}
        />
      )}
      {exportOpen && (
        <ExportDialog
          key={`${date}:${revision}`}
          date={date}
          onClose={() => setExportOpen(false)}
        />
      )}
      {deleteEntry && (
        <Modal title="要删掉这一刻吗？" onClose={() => setDeleteEntry(undefined)} busy={deleting}>
          <p className="muted">这条动态和上传的照片会被删除，无法撤回。</p>
          {deleteError && (
            <p role="alert" className="error-banner">
              {deleteError}
            </p>
          )}
          <div className="confirm-actions">
            <Button
              type="default"
              className="island-control secondary"
              disabled={deleting}
              onClick={() => setDeleteEntry(undefined)}
            >
              再想想
            </Button>
            <Button
              type="default"
              danger
              className="island-control danger-button"
              disabled={deleting}
              onClick={remove}
            >
              {deleting ? (
                <IslandIcon icon={LoaderCircle} size={17} className="spin" />
              ) : (
                '确认删除'
              )}
            </Button>
          </div>
        </Modal>
      )}
      {credits && (
        <Modal title="让日常更可爱的朋友们" onClose={() => setCredits(false)}>
          <div className="credits">
            <p>界面组件：animal-island-ui · guokaigdg</p>
            <a
              href="https://github.com/guokaigdg/animal-island-ui"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-NC 4.0 许可 · 非商业使用
            </a>
            <p>和朋友的同一时间 © {today().slice(0, 4)}</p>
            <p>谢谢这些让日常更可爱的小伙伴！以下开源图片未经修改。</p>
            <a href="https://github.com/microsoft/fluentui-emoji" target="_blank" rel="noreferrer">
              Fluent Emoji · © Microsoft
            </a>
            <a href="/licenses/fluent.txt">MIT 许可</a>
            <a href="https://github.com/jdecked/twemoji" target="_blank" rel="noreferrer">
              Twemoji · © Twitter, Inc. and contributors
            </a>
            <a href="/licenses/twemoji.txt">CC BY 4.0 许可</a>
            <a href="https://openmoji.org" target="_blank" rel="noreferrer">
              OpenMoji · © HfG Schwäbisch Gmünd and contributors
            </a>
            <a href="/licenses/openmoji.txt">CC BY-SA 4.0 许可</a>
            <p>Noto Sans CJK · © The Noto Project Authors</p>
            <a href="/licenses/font.txt">SIL Open Font License 1.1</a>
            <h3>陪我们冒泡的音乐</h3>
            <p>音乐会按视频长度裁剪或循环，调整响度并淡入淡出。</p>
            {videoMusic.map((music) => (
              <div key={music.id}>
                <a href={music.source} target="_blank" rel="noreferrer">
                  {music.title} · {music.artist} / Incompetech
                </a>
                {' · '}
                <a href={music.licenseUrl} target="_blank" rel="noreferrer">
                  {music.license}
                </a>
              </div>
            ))}
            <a href="/licenses/music.txt">完整音乐许可与来源</a>
          </div>
        </Modal>
      )}
      {membersOpen && <CircleMembers onClose={() => setMembersOpen(false)} />}
      {toast && (
        <div className="toast" role="status">
          <IslandIcon icon={Check} size={17} />
          {toast}
        </div>
      )}
    </>
  );
}
