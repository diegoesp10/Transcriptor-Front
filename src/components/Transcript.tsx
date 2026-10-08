import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronUp, Info, Pencil, Search, Sparkles, X } from 'lucide-react';
import type { TranscriptDto, TranscriptSegment } from '../api/types';
import { useI18n } from '../i18n';
import { Panel } from './Panel';
import { formatClock } from '../utils/format';
import { paragraphs, speakerName, type SpeakerNaming } from '../utils/transcript';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlight(text: string, query: string): ReactNode {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${escapeRegExp(query)})`, 'gi'));
  return parts.map((part, index) => (index % 2 === 1 ? <mark key={index}>{part}</mark> : part));
}

interface RowProps {
  segment: TranscriptSegment;
  index: number;
  name: string;
  color: number;
  /** Mismo hablante que la fila anterior: no se repite su nombre */
  continued: boolean;
  active: boolean;
  query: string;
  canSeek: boolean;
  onSeek: (seconds: number) => void;
}

const Row = memo(function Row({ segment, index, name, color, continued, active, query, canSeek, onSeek }: RowProps) {
  const { t } = useI18n();
  const style = { '--spk': `var(--spk-${color % 8})` } as CSSProperties;
  return (
    <li id={`seg-${index}`} className={`seg ${active ? 'is-active' : ''} ${continued ? 'is-continued' : ''}`} style={style}>
      <button className="seg-time mono" onClick={() => onSeek(segment.startSeconds)} disabled={!canSeek} title={canSeek ? t('transcript.play') : undefined} aria-label={canSeek ? t('transcript.playAt', { time: formatClock(segment.startSeconds) }) : undefined}>
        {formatClock(segment.startSeconds)}
      </button>
      <div className="seg-body">
        {!continued && (
          <span className="seg-speaker">
            <i aria-hidden />
            {name}
          </span>
        )}
        {paragraphs(segment.text).map((paragraph, i) => (
          <p key={i}>{highlight(paragraph, query)}</p>
        ))}
      </div>
    </li>
  );
});

interface Props {
  dto: TranscriptDto;
  naming: SpeakerNaming;
  speakers: string[];
  /** Hay audio guardado en el navegador: se puede saltar a un punto y seguir la reproducción */
  canSeek: boolean;
  time: number;
  playing: boolean;
  onSeek: (seconds: number) => void;
  onRename: (speaker: string, name: string) => void;
  /** Segmento al que ir desde fuera (p. ej. desde el análisis) */
  focus: { index: number; nonce: number } | null;
  /** Título de la ventana del documento (el nombre de la reunión) */
  title: string;
}

export function Transcript({ dto, naming, speakers, canSeek, time, playing, onSeek, onRename, focus, title }: Props) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLOListElement>(null);

  const colorOf = useMemo(() => new Map(speakers.map((speaker, index) => [speaker, index])), [speakers]);
  const segments = dto.segments;

  // Fila activa: la última que ya ha empezado (búsqueda binaria) si el audio está sonando o se ha movido
  const active = useMemo(() => {
    if (!canSeek || (time === 0 && !playing)) return -1;
    let low = 0;
    let high = segments.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (segments[mid].startSeconds <= time) {
        found = mid;
        low = mid + 1;
      } else high = mid - 1;
    }
    return found;
  }, [segments, time, canSeek, playing]);

  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (needle.length < 2) return [];
    return segments.flatMap((segment, index) => (segment.text.toLocaleLowerCase().includes(needle) ? [index] : []));
  }, [segments, query]);

  const scrollTo = (index: number) => document.getElementById(`seg-${index}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });

  useEffect(() => {
    setCursor(0);
    if (matches.length > 0) scrollTo(matches[0]);
  }, [matches]);

  useEffect(() => {
    if (focus) scrollTo(focus.index);
  }, [focus]);

  useEffect(() => {
    if (follow && playing && active >= 0) scrollTo(active);
  }, [active, follow, playing]);

  const step = (delta: number) => {
    if (matches.length === 0) return;
    const next = (cursor + delta + matches.length) % matches.length;
    setCursor(next);
    scrollTo(matches[next]);
  };

  const needle = query.trim().length >= 2 ? query.trim() : '';

  return (
    <div className="transcript">
      <SpeakerList speakers={speakers} naming={naming} onRename={onRename} />

      {dto.timing === 'chunk' && (
        <p className="note">
          <Info size={16} aria-hidden />
          {t('transcript.chunkTiming')}
        </p>
      )}

      <div className="transcript-tools">
        <label className="search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') step(event.shiftKey ? -1 : 1);
            }}
            placeholder={t('transcript.search')}
            aria-label={t('transcript.search')}
          />
          {needle && (
            <span className="search-count mono" aria-live="polite">
              {matches.length === 0 ? t('transcript.noMatches') : `${cursor + 1}/${matches.length}`}
            </span>
          )}
        </label>
        {needle && matches.length > 1 && (
          <div className="stepper">
            <button className="icon-btn icon-btn-sm" onClick={() => step(-1)} aria-label={t('transcript.prev')}>
              <ChevronUp size={16} />
            </button>
            <button className="icon-btn icon-btn-sm" onClick={() => step(1)} aria-label={t('transcript.next')}>
              <ChevronDown size={16} />
            </button>
          </div>
        )}
        {canSeek && (
          <label className="switch switch-sm">
            <input type="checkbox" checked={follow} onChange={(event) => setFollow(event.target.checked)} />
            <i aria-hidden />
            <span>{t('transcript.follow')}</span>
          </label>
        )}
      </div>

      {segments.length === 0 ? (
        <p className="muted state-center">{t('transcript.empty')}</p>
      ) : (
        <Panel className="document" title={title} aside={t('transcript.count', { count: segments.length })} flush>
        <ol className="segments" ref={list}>
          {segments.map((segment, index) => {
            const name = speakerName(segment.speaker, naming);
            const previous = index > 0 ? speakerName(segments[index - 1].speaker, naming) : null;
            return (
              <Row
                key={index}
                segment={segment}
                index={index}
                name={name}
                color={segment.speaker ? (colorOf.get(segment.speaker) ?? 0) : 0}
                continued={previous === name}
                active={index === active}
                query={needle}
                canSeek={canSeek}
                onSeek={onSeek}
              />
            );
          })}
        </ol>
        </Panel>
      )}
    </div>
  );
}

const COLLAPSED_SPEAKERS = 5;

function SpeakerList({ speakers, naming, onRename }: { speakers: string[]; naming: SpeakerNaming; onRename: (speaker: string, name: string) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [expanded, setExpanded] = useState(false);
  if (speakers.length === 0) return null;
  // Con reuniones largas hay muchas etiquetas (una por voz y fragmento): se muestran las primeras y el resto bajo demanda
  const visible = expanded ? speakers : speakers.slice(0, COLLAPSED_SPEAKERS);

  const commit = () => {
    if (editing) onRename(editing, draft);
    setEditing(null);
  };

  return (
    <section className="speakers" aria-label={t('transcript.speakers')}>
      <ul>
        {visible.map((speaker) => (
          <li key={speaker} style={{ '--spk': `var(--spk-${speakers.indexOf(speaker) % 8})` } as CSSProperties}>
            {editing === speaker ? (
              <form
                className="speaker-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  commit();
                }}
              >
                <i aria-hidden />
                <input
                  autoFocus
                  value={draft}
                  maxLength={60}
                  placeholder={speakerName(speaker, { ...naming, names: {} })}
                  aria-label={t('transcript.renameSpeaker')}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') setEditing(null);
                  }}
                />
                <button type="submit" className="icon-btn icon-btn-sm" aria-label={t('common.save')}>
                  <Check size={14} />
                </button>
                <button type="button" className="icon-btn icon-btn-sm" onClick={() => setEditing(null)} aria-label={t('common.cancel')}>
                  <X size={14} />
                </button>
              </form>
            ) : (
              <button
                className="speaker-chip"
                onClick={() => {
                  setDraft(naming.names[speaker] ?? '');
                  setEditing(speaker);
                }}
                title={!naming.names[speaker] && naming.detected[speaker] ? t('speaker.detectedHint') : t('transcript.renameSpeaker')}
              >
                <i aria-hidden />
                {speakerName(speaker, naming)}
                {/* Nombre que dio el servidor porque la persona se presentó (mientras el usuario no ponga otro) */}
                {!naming.names[speaker] && naming.detected[speaker] && <Sparkles size={12} className="speaker-detected" aria-label={t('speaker.detectedHint')} />}
                <Pencil size={12} aria-hidden />
              </button>
            )}
          </li>
        ))}
        {speakers.length > COLLAPSED_SPEAKERS && (
          <li>
            <button className="chip-btn speakers-toggle" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
              {expanded ? t('transcript.showFewer') : t('transcript.showAll', { count: speakers.length })}
            </button>
          </li>
        )}
      </ul>
      {naming.multiChunk && (
        <p className="note">
          <Info size={16} aria-hidden />
          {t('transcript.speakerScope')}
        </p>
      )}
    </section>
  );
}
