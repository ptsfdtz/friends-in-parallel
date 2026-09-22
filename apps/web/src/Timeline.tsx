import { Icon as IslandIcon, Button } from 'animal-island-ui';
import { PostShare } from './PostShare';
import { Photo } from './Photo';
import { useEffect, useRef, useState } from 'react';
import {
  Pencil,
  Trash2,
  Clock,
  MoreHorizontal,
  LoaderCircle,
  Users,
  ChevronDown,
  Check,
} from 'lucide-react';
import { people, personOf, timeOf, mediaSrc, mediaName, today, type Entry } from './lib';
import { Modal } from './Modal';
import { Masonry } from './Masonry';
export function Timeline({
  entries,
  loading,
  error,
  onRefresh,
  onEdit,
  onDelete,
  focusId,
  date,
}: {
  entries: Entry[];
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onEdit: (e: Entry) => void;
  onDelete: (e: Entry) => void;
  focusId: string;
  date: string;
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterTrigger = useRef<HTMLButtonElement>(null);
  function closeFilter() {
    setFilterOpen(false);
    requestAnimationFrame(() => filterTrigger.current?.focus({ preventScroll: true }));
  }
  const [filter, setFilter] = useState('all'),
    [zoom, setZoom] = useState<Entry>(),
    [actions, setActions] = useState<Entry>();
  useEffect(() => {
    if (focusId) setFilter('all');
  }, [focusId]);
  const visible = entries
    .filter((e) => filter === 'all' || e.personId === filter)
    .sort(
      (a, b) =>
        b.occurredAt.localeCompare(a.occurredAt) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.id.localeCompare(a.id),
    );
  const hours = [...new Set(visible.map((e) => timeOf(e.occurredAt).slice(0, 2)))].sort().reverse();
  return (
    <section className="timeline-view" aria-labelledby="moments-heading">
      <div className="timeline-heading">
        <h2 id="moments-heading">{date === today() ? '今天的瞬间' : '这一天的瞬间'}</h2>
        <Button
          type="text"
          className="island-control friend-filter-trigger"
          aria-label={`筛选朋友：${filter === 'all' ? '全部朋友' : personOf(filter).nickname}`}
          aria-haspopup="dialog"
          aria-expanded={filterOpen}
          onClick={(event) => {
            filterTrigger.current = event.currentTarget;
            setFilterOpen(true);
          }}
        >
          <span
            className="filter-avatar"
            style={filter === 'all' ? undefined : { background: personOf(filter).background }}
          >
            {filter === 'all' ? (
              <IslandIcon icon={Users} size={18} />
            ) : (
              <img src={`/stickers/fluent/${personOf(filter).avatar}.png`} alt="" />
            )}
          </span>
          <span className="friend-filter-label">
            {filter === 'all' ? '全部朋友' : personOf(filter).nickname}
          </span>
          <IslandIcon icon={ChevronDown} size={15} />
        </Button>
      </div>
      {filterOpen && (
        <Modal title="选择朋友" onClose={closeFilter}>
          <div className="friend-filter-options" role="group" aria-label="按人物筛选">
            {[{ id: 'all', nickname: '全部朋友', avatar: '', background: '' }, ...people].map(
              (person) => (
                <Button
                  key={person.id}
                  type="text"
                  className={`island-control friend-filter-option ${filter === person.id ? 'selected' : ''}`}
                  aria-pressed={filter === person.id}
                  onClick={() => {
                    setFilter(person.id);
                    closeFilter();
                  }}
                >
                  <span
                    className="avatar"
                    style={{ background: person.background || 'var(--animal-primary-color-bg)' }}
                  >
                    {person.id === 'all' ? (
                      <IslandIcon icon={Users} size={21} />
                    ) : (
                      <img src={`/stickers/fluent/${person.avatar}.png`} alt="" />
                    )}
                  </span>
                  <span>
                    {person.nickname}
                    {!loading && !error && (
                      <span className="friend-post-count">
                        {' '}
                        （
                        {person.id === 'all'
                          ? entries.length
                          : entries.filter((entry) => entry.personId === person.id).length}
                        条）
                      </span>
                    )}
                  </span>
                  <span className="friend-filter-check" aria-hidden="true">
                    {filter === person.id && <IslandIcon icon={Check} size={18} />}
                  </span>
                </Button>
              ),
            )}
          </div>
        </Modal>
      )}
      {error && (
        <div className="empty-state">
          <p role="alert">{error}</p>
          <Button type="default" className="island-control secondary" onClick={onRefresh}>
            再试一次
          </Button>
        </div>
      )}
      {loading ? (
        <div className="empty-state" role="status">
          <IslandIcon icon={LoaderCircle} size={28} className="spin" />
          <p>正在翻到这一天…</p>
        </div>
      ) : !visible.length ? (
        <div className="empty-state">
          <span className="empty-illustration">
            <IslandIcon icon={Users} size={32} />
          </span>
          <h2>
            {filter === 'all'
              ? '朋友们还没冒泡，先来一条？'
              : `${personOf(filter).nickname}这天还没冒泡`}
          </h2>
          <p>
            {date === today()
              ? '放张照片，丢个表情，说说你在干嘛。'
              : '过去的小事，也可以慢慢补上。'}
          </p>
        </div>
      ) : (
        <div className="hour-timeline">
          {hours.map((hour, hourIndex) => {
            const hourEntries = visible.filter((e) => timeOf(e.occurredAt).startsWith(hour));
            const companions = [...new Set(hourEntries.map((e) => e.personId))].map(personOf);
            return (
              <section className="hour-group" key={`${filter}:${hour}`} style={{ '--motion-index': Math.min(hourIndex, 4) } as React.CSSProperties}>
                <div className="hour-heading">
                  <time>{hour}:00</time>
                  <span className="hour-line" />
                  {companions.length > 1 && (
                    <div className="same-hour">
                      <span className="companion-avatars">
                        {companions.map((p) => (
                          <img
                            key={p.id}
                            src={`/stickers/fluent/${p.avatar}.png`}
                            alt={p.nickname}
                            style={{ background: p.background }}
                          />
                        ))}
                      </span>
                      <span>{companions.length} 位朋友的此刻</span>
                    </div>
                  )}
                </div>
                <Masonry>
                  {hourEntries.map((entry) => {
                    const p = personOf(entry.personId);
                    return (
                      <article
                        key={entry.id}
                        id={`entry-${entry.id}`}
                        className={`moment-card ${focusId === entry.id ? 'just-posted' : ''}`}
                      >
                        <header className="card-header">
                          <span className="avatar small" style={{ background: p.background }}>
                            <img src={`/stickers/fluent/${p.avatar}.png`} alt="" />
                          </span>
                          <div>
                            <strong>{p.nickname}</strong>
                            <time>
                              <IslandIcon icon={Clock} size={11} />
                              {timeOf(entry.occurredAt)}
                            </time>
                          </div>
                          <Button
                            type="text"
                            className="island-control icon-button card-actions"
                            aria-label={`更多操作：${p.nickname} ${timeOf(entry.occurredAt)}`}
                            onClick={() => setActions(entry)}
                          >
                            <IslandIcon icon={MoreHorizontal} size={20} />
                          </Button>
                        </header>
                        <div
                          className={`moment-body ${entry.media.type === 'photo' ? 'photo-body' : 'expression-body'}`}
                        >
                          <Button
                            type="text"
                            className={
                              'island-control ' +
                              `moment-media ${entry.media.type === 'photo' ? 'photo' : 'sticker'}`
                            }
                            aria-label={`查看${mediaName(entry.media)}`}
                            onClick={() => setZoom(entry)}
                          >
                            <Photo
                              src={mediaSrc(entry.media)}
                              alt={mediaName(entry.media)}
                              loading="lazy"
                            />
                          </Button>
                          {entry.description && (
                            <p className="moment-description">{entry.description}</p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </Masonry>
              </section>
            );
          })}
        </div>
      )}
      {actions && (
        <Modal title="动态操作" onClose={() => setActions(undefined)}>
          <div className="entry-options">
            {mediaSrc(actions.media) && <PostShare entry={actions} />}
            <Button
              type="default"
              className="island-control secondary full"
              aria-label={`编辑${personOf(actions.personId).nickname}的动态`}
              onClick={() => {
                onEdit(actions);
                setActions(undefined);
              }}
            >
              <IslandIcon icon={Pencil} size={18} />
              编辑动态
            </Button>
            <Button
              type="default"
              danger
              className="island-control danger-button full"
              aria-label={`删除${personOf(actions.personId).nickname}的动态`}
              onClick={() => {
                onDelete(actions);
                setActions(undefined);
              }}
            >
              <IslandIcon icon={Trash2} size={18} />
              删除动态
            </Button>
          </div>
        </Modal>
      )}
      {zoom && (
        <Modal
          className="post-modal"
          title={`${personOf(zoom.personId).nickname} · ${timeOf(zoom.occurredAt)}`}
          onClose={() => setZoom(undefined)}
        >
          {zoom.description && <p className="moment-description">{zoom.description}</p>}
          <Photo className="zoom-image" src={mediaSrc(zoom.media)} alt={mediaName(zoom.media)} />
          {mediaSrc(zoom.media) && <PostShare entry={zoom} />}
        </Modal>
      )}
    </section>
  );
}
