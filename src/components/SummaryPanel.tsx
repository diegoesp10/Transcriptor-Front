import { useState } from 'react';
import { AlertCircle, Info, RefreshCw, Sparkles } from 'lucide-react';
import type { SummaryPointDto, SummaryResponseDto } from '../api/types';
import type { LibraryItem } from '../db/model';
import { useI18n } from '../i18n';
import { useEngine } from '../state/engine';
import { useLibrary } from '../state/library';
import { codeText, summaryErrorText } from '../utils/errors';
import { relativeTime } from '../utils/format';
import { Loader } from './Loader';
import { Panel } from './Panel';

interface Props {
  item: LibraryItem;
  summary: SummaryResponseDto | undefined;
  onSummary: (summary: SummaryResponseDto) => void;
  /** Ir a ese segmento (índice base cero) en la transcripción */
  onJump: (segmentIndex: number) => void;
}

/**
 * Resumen bajo demanda con el modelo local del servidor (Ollama). Tarda minutos y el servidor solo hace uno a la vez,
 * así que nunca se lanza solo ni se reintenta. Es siempre un borrador: cada punto lleva los números de los segmentos que
 * lo respaldan para poder comprobarlo con la transcripción.
 */
export function SummaryPanel({ item, summary, onSummary, onJump }: Props) {
  const { t, locale } = useI18n();
  const library = useLibrary();
  const { config } = useEngine();
  // Aviso previo si el servidor ya sabe que el resumidor no está listo (no se bloquea: el estado puede haber cambiado)
  const engineWarning = config && !config.summaryReady ? (codeText(config.summaryErrorCode, t) ?? t('summary.errors.unavailable')) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gone = item.serverCopy === 'deleted';

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      onSummary(await library.requestSummary(item.id));
    } catch (caught) {
      setError(summaryErrorText(caught, t));
    } finally {
      setBusy(false);
    }
  };

  const sections: [string, SummaryPointDto[]][] = summary
    ? [
        [t('summary.highlights'), summary.summary.highlights],
        [t('summary.decisions'), summary.summary.decisions],
        [t('summary.actionItems'), summary.summary.actionItems],
        [t('summary.openQuestions'), summary.summary.openQuestions],
      ]
    : [];

  return (
    <Panel className="panel summary-panel" title={t('summary.title')} aside={summary ? t('summary.draftShort') : undefined}>
      {!summary && (
        <>
          <p className="muted">{gone ? t('summary.unavailable') : t('summary.cost')}</p>
          {!gone && engineWarning && !error && (
            <p className="note">
              <Info size={16} aria-hidden />
              {engineWarning}
            </p>
          )}
          {!gone && (
            <div>
              <button className="btn btn-primary" onClick={() => void generate()} disabled={busy}>
                {busy ? <Loader /> : <Sparkles size={16} />}
                {busy ? t('summary.generating') : t('summary.generate')}
              </button>
            </div>
          )}
        </>
      )}

      {summary && (
        <>
          <p className="note">
            <Info size={16} aria-hidden />
            {t('summary.draftNotice')}
          </p>
          <section>
            <h4>{t('summary.overview')}</h4>
            <p className="summary-overview">{summary.summary.overview}</p>
          </section>
          {sections.map(([title, points]) => (
            <section key={title}>
              <h4>{title}</h4>
              {points.length === 0 ? (
                <p className="muted">{t('summary.none')}</p>
              ) : (
                <ul className="summary-points">
                  {points.map((point, index) => (
                    <li key={index}>
                      <p>{point.text}</p>
                      <span className="evidence">
                        {point.evidenceSegmentIndices.map((segment) => (
                          <button key={segment} className="chip-btn mono" onClick={() => onJump(segment)} title={t('summary.evidence', { n: segment + 1 })} aria-label={t('summary.evidence', { n: segment + 1 })}>
                            {segment + 1}
                          </button>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <p className="muted small">{t('summary.evidenceNote')}</p>
          <div className="summary-foot">
            <span className="muted small">{t('summary.generatedAt', { when: relativeTime(summary.generatedAt, locale) })}</span>
            {!gone && (
              <button className="btn btn-sm" onClick={() => void generate()} disabled={busy}>
                {busy ? <Loader size={15} /> : <RefreshCw size={15} />}
                {busy ? t('summary.generating') : t('summary.regenerate')}
              </button>
            )}
          </div>
        </>
      )}

      {error && (
        <div className="banner banner-danger" role="alert">
          <AlertCircle size={18} aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </Panel>
  );
}
