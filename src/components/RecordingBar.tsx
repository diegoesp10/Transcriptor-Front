import { ArrowRight, Pause, Play, Square } from 'lucide-react';
import { useI18n } from '../i18n';
import { hrefOf } from '../state/route';
import { useRecording } from '../state/recorder';
import { formatDuration } from '../utils/format';

/** Píldora flotante: mientras se graba (o hay una grabación sin guardar) se ve desde cualquier pantalla menos el estudio */
export function RecordingBar() {
  const { t } = useI18n();
  const { phase, elapsed, pending, pause, resume, stop } = useRecording();
  const live = phase === 'recording' || phase === 'paused';
  if (!live && !pending) return null;

  return (
    <div className="recbar glass" role="status">
      <span className={`recbar-dot ${phase === 'paused' ? 'is-paused' : ''} ${live ? '' : 'is-done'}`} aria-hidden />
      <span className="recbar-text">
        {live ? (phase === 'paused' ? t('recbar.paused') : t('recbar.recording')) : t('recbar.ready')}
        {live && <span className="mono"> · {formatDuration(elapsed)}</span>}
      </span>
      {live && (
        <>
          <button className="icon-btn icon-btn-sm" onClick={phase === 'paused' ? resume : pause} aria-label={phase === 'paused' ? t('recorder.resume') : t('recorder.pause')}>
            {phase === 'paused' ? <Play size={15} fill="currentColor" /> : <Pause size={15} fill="currentColor" />}
          </button>
          <button className="icon-btn icon-btn-sm recbar-stop" onClick={stop} aria-label={t('recorder.stop')}>
            <Square size={14} fill="currentColor" />
          </button>
        </>
      )}
      <a className="recbar-link" href={hrefOf({ name: 'studio' })}>
        {live ? t('recbar.open') : t('recbar.review')}
        <ArrowRight size={14} />
      </a>
    </div>
  );
}
