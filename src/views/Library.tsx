import { useMemo, useState, type FormEvent } from 'react';
import { Link2, Mic, Search, AudioLines } from 'lucide-react';
import { EmptyState } from '../components/EmptyState';
import { ItemCard } from '../components/ItemCard';
import { Panel } from '../components/Panel';
import { Loader } from '../components/Loader';
import { useI18n } from '../i18n';
import { isBusy, isGuid, useLibrary } from '../state/library';
import { hrefOf, type Route } from '../state/route';
import { useToasts } from '../state/toasts';
import { apiErrorText } from '../utils/errors';
import type { LibraryItem } from '../db/model';

type Filter = 'all' | 'active' | 'done' | 'attention' | 'local';

const FILTERS: Record<Filter, (item: LibraryItem) => boolean> = {
  all: () => true,
  active: isBusy,
  done: (item) => item.status === 'Completed',
  attention: (item) => item.status === 'Failed' || item.status === 'uploadFailed',
  local: (item) => item.status === 'local',
};

export function Library({ navigate }: { navigate: (route: Route) => void }) {
  const { t } = useI18n();
  const { items, ready, openRemote } = useLibrary();
  const toast = useToasts();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [byId, setById] = useState(false);
  const [meetingId, setMeetingId] = useState('');
  const [opening, setOpening] = useState(false);

  const sorted = useMemo(() => [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [items]);
  const counts = useMemo(() => {
    const result = {} as Record<Filter, number>;
    for (const key of Object.keys(FILTERS) as Filter[]) result[key] = sorted.filter(FILTERS[key]).length;
    return result;
  }, [sorted]);
  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return sorted.filter((item) => FILTERS[filter](item) && (!needle || item.name.toLocaleLowerCase().includes(needle)));
  }, [sorted, filter, query]);

  const open = async (event: FormEvent) => {
    event.preventDefault();
    if (!isGuid(meetingId)) return toast.push('error', t('library.byId.invalid'));
    setOpening(true);
    try {
      const item = await openRemote(meetingId);
      setById(false);
      setMeetingId('');
      navigate({ name: 'meeting', id: item.id });
    } catch (error) {
      toast.push('error', apiErrorText(error, t));
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="view library">
      <header className="page-head page-head-row">
        <div>
          <h1>
            {t('library.title1')} <em>{t('library.title2')}</em>
          </h1>
        </div>
        <button className="btn" onClick={() => setById((value) => !value)} aria-expanded={byId}>
          <Link2 size={16} />
          {t('library.byId.open')}
        </button>
      </header>

      {byId && (
        <form className="by-id card" onSubmit={open}>
          <label className="field">
            <span>{t('library.byId.label')}</span>
            <input value={meetingId} onChange={(event) => setMeetingId(event.target.value)} placeholder="00000000-0000-0000-0000-000000000000" spellCheck={false} autoFocus className="mono" />
          </label>
          <button className="btn btn-primary" disabled={opening || !meetingId.trim()}>
            {opening && <Loader />}
            {t('library.byId.submit')}
          </button>
          <p className="muted">{t('library.byId.note')}</p>
        </form>
      )}

      <div className="toolbar">
        <label className="search">
          <Search size={16} aria-hidden />
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('library.search')} aria-label={t('library.search')} />
        </label>
        <div className="chips" role="tablist" aria-label={t('library.filters')}>
          {(Object.keys(FILTERS) as Filter[]).map((key) => (
            <button key={key} role="tab" aria-selected={filter === key} className={`chip ${filter === key ? 'is-on' : ''}`} onClick={() => setFilter(key)} disabled={key !== 'all' && counts[key] === 0}>
              {t(`library.filter.${key}`)}
              <b>{counts[key]}</b>
            </button>
          ))}
        </div>
      </div>

      {!ready ? (
        <div className="state-center">
          <Loader size={28} />
        </div>
      ) : items.length === 0 ? (
        <Panel>
          <EmptyState icon={AudioLines} title={t('library.empty.title')} text={t('library.empty.text')}>
            <a className="btn btn-primary" href={hrefOf({ name: 'studio' })}>
              <Mic size={16} />
              {t('library.empty.cta')}
            </a>
          </EmptyState>
        </Panel>
      ) : shown.length === 0 ? (
        <p className="muted state-center">{t('library.noResults')}</p>
      ) : (
        <div className="grid">
          {shown.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
