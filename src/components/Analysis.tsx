import type { CSSProperties, ReactNode } from 'react';
import { Clock3, HelpCircle, MessageSquareQuote, Users, Zap } from 'lucide-react';
import { useI18n } from '../i18n';
import { Panel } from './Panel';
import { formatClock, formatDuration } from '../utils/format';
import type { Analysis as AnalysisData, Finding } from '../utils/transcript';

interface Props {
  analysis: AnalysisData;
  /** Ir a ese segmento en la transcripción */
  onJump: (segmentIndex: number) => void;
  /** Saltar a un instante del audio (si hay audio guardado) */
  onSeek: (seconds: number) => void;
  canSeek: boolean;
  time: number;
  duration: number;
  /** Las etiquetas de voz vienen por fragmento: no son personas distintas necesariamente */
  multiChunk: boolean;
}

const spk = (index: number) => ({ '--spk': `var(--spk-${index % 8})` }) as CSSProperties;

/**
 * Lectura rápida de la reunión. Todo se calcula en el navegador con recuentos y patrones de texto: no es un resumen de IA y
 * puede equivocarse, así que cada hallazgo enlaza con el momento exacto para comprobarlo.
 */
export function Analysis({ analysis, onJump, onSeek, canSeek, time, duration, multiChunk }: Props) {
  const { t, locale } = useI18n();
  const number = (value: number) => value.toLocaleString(locale);
  const maxKeyword = Math.max(1, ...analysis.keywords.map((keyword) => keyword.count));

  return (
    <div className="analysis">
      <p className="note note-top">
        <Zap size={16} aria-hidden />
        {t('analysis.disclaimer')}
      </p>

      <ul className="stats">
        <Stat icon={<Clock3 size={18} />} label={t('analysis.duration')} value={formatDuration(analysis.durationSec)} />
        <Stat icon={<MessageSquareQuote size={18} />} label={t('analysis.words')} value={number(analysis.words)} />
        <Stat icon={<Users size={18} />} label={multiChunk ? t('analysis.voiceLabels') : t('analysis.speakers')} value={number(analysis.speakers.length)} />
        <Stat icon={<HelpCircle size={18} />} label={t('analysis.questions')} value={number(analysis.questions.length)} />
        {analysis.wordsPerMinute != null && <Stat icon={<Zap size={18} />} label={t('analysis.pace')} value={`${number(analysis.wordsPerMinute)} ${t('analysis.wpm')}`} />}
      </ul>

      {analysis.speakers.length > 0 && (
        <Panel className="panel" title={t('analysis.whoSpeaks')}>
          <div className="share-bar" role="img" aria-label={analysis.speakers.map((s) => `${s.name} ${Math.round(s.share * 100)}%`).join(', ')}>
            {analysis.speakers.map((speaker) => (
              <i key={speaker.name} style={{ ...spk(speaker.colorIndex), flexGrow: Math.max(speaker.share, 0.015) }} title={`${speaker.name} · ${Math.round(speaker.share * 100)}%`} />
            ))}
          </div>
          <ul className="share-list">
            {analysis.speakers.map((speaker) => (
              <li key={speaker.name} style={spk(speaker.colorIndex)}>
                <i aria-hidden />
                <span className="share-name">{speaker.name}</span>
                <span className="share-value mono">{Math.round(speaker.share * 100)}%</span>
                <span className="share-detail">
                  {t('analysis.wordsCount', { count: speaker.words, n: number(speaker.words) })}
                  {analysis.timed && ` · ${formatDuration(speaker.seconds)}`}
                  {` · ${t('analysis.turns', { count: speaker.turns })}`}
                </span>
              </li>
            ))}
          </ul>
          {!analysis.timed && <p className="muted small">{t('analysis.shareByWords')}</p>}
        </Panel>
      )}

      {analysis.timed && analysis.timeline.length > 0 && analysis.durationSec > 0 && (
        <Panel className="panel" title={t('analysis.timeline')}>
          <div className="timeline">
            {analysis.timeline.map((block, index) => (
              <button
                key={index}
                style={{ ...spk(block.colorIndex), left: `${(block.start / analysis.durationSec) * 100}%`, width: `${Math.max(((block.end - block.start) / analysis.durationSec) * 100, 0.25)}%` }}
                title={`${block.name} · ${formatClock(block.start)}`}
                aria-label={`${block.name} · ${formatClock(block.start)}`}
                onClick={() => onJump(index)}
              />
            ))}
            {canSeek && duration > 0 && <i className="timeline-head" style={{ left: `${Math.min(100, (time / duration) * 100)}%` }} aria-hidden />}
          </div>
          <div className="timeline-scale mono" aria-hidden>
            <span>00:00</span>
            <span>{formatClock(analysis.durationSec)}</span>
          </div>
        </Panel>
      )}

      {analysis.keywords.length > 0 && (
        <Panel className="panel" title={t('analysis.keywords')}>
          <ul className="cloud">
            {analysis.keywords.map((keyword) => (
              <li key={keyword.word} style={{ fontSize: `${0.9 + (keyword.count / maxKeyword) * 0.9}rem`, opacity: 0.55 + (keyword.count / maxKeyword) * 0.45 }} title={t('analysis.times', { count: keyword.count })}>
                {keyword.word}
                <sup>{keyword.count}</sup>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="findings">
        <FindingsPanel title={t('analysis.actions')} hint={t('analysis.actionsHint')} empty={t('analysis.actionsEmpty')} items={analysis.actions} onJump={onJump} onSeek={onSeek} canSeek={canSeek} />
        <FindingsPanel title={t('analysis.figures')} hint={t('analysis.figuresHint')} empty={t('analysis.figuresEmpty')} items={analysis.figures} onJump={onJump} onSeek={onSeek} canSeek={canSeek} emphasize />
        <FindingsPanel title={t('analysis.questionsTitle')} hint={null} empty={t('analysis.questionsEmpty')} items={analysis.questions} onJump={onJump} onSeek={onSeek} canSeek={canSeek} />
      </div>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <li className="stat card">
      <span className="stat-icon" aria-hidden>
        {icon}
      </span>
      <b>{value}</b>
      <span>{label}</span>
    </li>
  );
}

interface FindingsProps {
  title: string;
  hint: string | null;
  empty: string;
  items: Finding[];
  onJump: (segmentIndex: number) => void;
  onSeek: (seconds: number) => void;
  canSeek: boolean;
  /** Resalta el fragmento detectado dentro de la frase (cifras y fechas) */
  emphasize?: boolean;
}

function FindingsPanel({ title, hint, empty, items, onJump, onSeek, canSeek, emphasize }: FindingsProps) {
  const { t } = useI18n();
  return (
    <Panel className="panel" title={title} aside={String(items.length)}>
      {hint && <p className="muted small">{hint}</p>}
      {items.length === 0 ? (
        <p className="muted">{empty}</p>
      ) : (
        <ul className="finding-list">
          {items.map((finding, index) => (
            <li key={index}>
              <div className="finding-times">
                <button className="seg-time mono" onClick={() => onJump(finding.segmentIndex)} title={t('analysis.showInTranscript')}>
                  {formatClock(finding.start)}
                </button>
                {canSeek && (
                  <button className="chip-btn" onClick={() => onSeek(finding.start)} aria-label={t('analysis.listen')} title={t('analysis.listen')}>
                    ▶
                  </button>
                )}
              </div>
              <p>{emphasize ? withEmphasis(finding.sentence, finding.match) : finding.sentence}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function withEmphasis(sentence: string, match: string) {
  const at = sentence.indexOf(match);
  if (at < 0) return sentence;
  return (
    <>
      {sentence.slice(0, at)}
      <mark>{match}</mark>
      {sentence.slice(at + match.length)}
    </>
  );
}
