import { useState } from 'react';
import { AlertCircle, ArrowRight, Download, Hourglass, Info, Pause, Play, Trash2, WifiOff } from 'lucide-react';
import { ConfirmButton } from '../components/ConfirmButton';
import { Dropzone } from '../components/Dropzone';
import { EngineNotice } from '../components/EngineNotice';
import { FolderPanel } from '../components/FolderPanel';
import { LanguageSelect } from '../components/LanguageSelect';
import { LiveWave } from '../components/LiveWave';
import { Loader } from '../components/Loader';
import { MediaPlayer } from '../components/MediaPlayer';
import { MicPicker } from '../components/MicPicker';
import { Panel } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { useIngest } from '../hooks/useIngest';
import { useMediaPlayer } from '../hooks/useMediaPlayer';
import { usePrefs } from '../hooks/usePrefs';
import { supportsRecording } from '../hooks/useRecorder';
import type { BackendState } from '../hooks/useBackendStatus';
import { useI18n } from '../i18n';
import { useLibrary } from '../state/library';
import { useRecording } from '../state/recorder';
import { hrefOf, type Route } from '../state/route';
import { downloadBlob, extensionForMime, serverFileName } from '../utils/media';
import { formatClock, relativeTime, stamp } from '../utils/format';

interface Props {
  backend: BackendState;
  navigate: (route: Route) => void;
}

export function Studio({ backend, navigate }: Props) {
  const { t, locale } = useI18n();
  const { items } = useLibrary();
  const { pending } = useRecording();
  const ingest = useIngest();
  const { prefs } = usePrefs();
  const recent = items.slice(0, 4);

  return (
    <div className="view studio">
      <header className="page-head">
        <h1>
          {t('studio.title1')} <em>{t('studio.title2')}</em>
        </h1>
        <p className="lede">{t('studio.lede')}</p>
      </header>

      {backend === 'offline' && (
        <div className="banner banner-warn" role="status">
          <WifiOff size={18} aria-hidden />
          <span>{t('studio.offline')}</span>
        </div>
      )}
      {backend === 'limited' && (
        <div className="banner banner-warn" role="status">
          <Hourglass size={18} aria-hidden />
          <span>{t('backend.limited.long')}</span>
        </div>
      )}
      {backend === 'online' && <EngineNotice />}

      <div className="studio-grid">
        <Panel className="stage" title={pending ? t('review.title') : t('recorder.title')}>
          {pending ? <Review key={pending.startedAt} navigate={navigate} /> : <Recorder />}
        </Panel>

        <div className="studio-side">
          <FolderPanel variant="studio" />
          <Dropzone
            onFiles={async (files) => {
              const created = await ingest(files, prefs.language);
              if (created.length === 1) navigate({ name: 'meeting', id: created[0].id });
              else if (created.length > 1) navigate({ name: 'library' });
            }}
          />

          <Panel title={t('studio.recent')} aside={items.length > 0 ? String(items.length) : undefined} className="recent" flush>
            {recent.length === 0 ? (
              <p className="muted recent-empty">{t('studio.recentEmpty')}</p>
            ) : (
              <>
                <ul>
                  {recent.map((item) => (
                    <li key={item.id}>
                      <a href={hrefOf({ name: 'meeting', id: item.id })}>
                        <span className="recent-name">{item.name}</span>
                        <span className="recent-meta">{relativeTime(item.createdAt, locale)}</span>
                        <StatusBadge status={item.status} />
                      </a>
                    </li>
                  ))}
                </ul>
                <a className="recent-all" href={hrefOf({ name: 'library' })}>
                  {t('studio.seeAll')} <ArrowRight size={14} />
                </a>
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

const ERROR_KEYS = {
  unsupported: 'recorder.errors.unsupported',
  denied: 'recorder.errors.denied',
  noDevice: 'recorder.errors.noDevice',
  busy: 'recorder.errors.busy',
  failed: 'recorder.errors.failed',
} as const;

/**
 * Grabadora con un micrófono. Arriba, lo que se configura antes de empezar (idioma y micrófono); en el centro, el tiempo y
 * la onda; abajo, tres controles: pausa, grabar/parar y descartar.
 */
function Recorder() {
  const { t } = useI18n();
  const { prefs, update } = usePrefs();
  const { phase, elapsed, error, notice, start, stop, pause, resume, discard, historyRef } = useRecording();
  const live = phase === 'recording' || phase === 'paused';
  const paused = phase === 'paused';
  const waiting = phase === 'requesting';
  const canRecord = supportsRecording();
  const state = waiting ? t('deck.waiting') : paused ? t('recorder.pausedState') : live ? t('recorder.recordingState') : t('deck.ready');

  return (
    <div className="recorder">
      <div className="recorder-top">
        <LanguageSelect value={prefs.language} onChange={(language) => update({ language })} label={t('recorder.language')} disabled={live} />
      </div>

      <MicPicker disabled={live || waiting} />

      <div className="recorder-stage" role="timer" aria-label={t('recorder.recordingLabel')}>
        <div className={`recorder-state ${live && !paused ? 'is-rec' : ''}`}>
          <i aria-hidden />
          {state}
        </div>
        <div className={`recorder-time ${live ? '' : 'is-idle'}`}>{formatClock(live ? elapsed : 0)}</div>
        <div className="recorder-wave">
          <LiveWave historyRef={historyRef} recording={live && !paused} />
        </div>
      </div>

      <div className="recorder-controls">
        <div className="control">
          <button className="round round-gray" onClick={paused ? resume : pause} disabled={!live} aria-label={paused ? t('recorder.resume') : t('recorder.pause')}>
            {paused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
          </button>
          <span>{paused ? t('recorder.resume') : t('recorder.pause')}</span>
        </div>

        <div className="control">
          <button
            className={`round round-rec ${live ? 'is-live' : ''}`}
            onClick={live ? stop : () => void start(prefs.language, prefs.micId)}
            disabled={waiting || !canRecord}
            aria-label={live ? t('recorder.stop') : t('recorder.start')}
          >
            {waiting ? <Loader size={26} /> : <i className="rec-glyph" aria-hidden />}
          </button>
          <span>{live ? t('recorder.stop') : t('recorder.start')}</span>
        </div>

        <div className="control">
          <ConfirmButton className="round round-gray" iconOnly icon={<Trash2 size={21} />} label={t('recorder.discard')} confirmLabel={t('recorder.discardConfirm')} disabled={!live} onConfirm={discard} />
          <span>{t('recorder.discard')}</span>
        </div>
      </div>

      {!live && <p className="recorder-hint">{!canRecord ? t('recorder.errors.unsupported') : t('recorder.hintMic')}</p>}

      {notice === 'micFallback' && (
        <div className="banner banner-info" role="status">
          <Info size={18} aria-hidden />
          <span>{t('mic.fallback')}</span>
        </div>
      )}

      {error && (
        <div className="banner banner-danger" role="alert">
          <AlertCircle size={18} aria-hidden />
          <span>{t(ERROR_KEYS[error])}</span>
        </div>
      )}
    </div>
  );
}

/** Revisión de la grabación recién detenida: escuchar, nombrar y decidir qué hacer con ella */
function Review({ navigate }: { navigate: (route: Route) => void }) {
  const { t, locale } = useI18n();
  const { prefs } = usePrefs();
  const { addMedia } = useLibrary();
  const { pending, closePending } = useRecording();
  const [title, setTitle] = useState(() => `${t('recorder.defaultName')} ${stamp(new Date(), locale)}`);
  const [language, setLanguage] = useState(prefs.language);
  const [transcribeNow, setTranscribeNow] = useState(prefs.autoTranscribe);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const player = useMediaPlayer(pending?.blob, pending?.durationSec ?? null);
  if (!pending) return null;

  const save = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const name = title.trim() || t('recorder.defaultName');
      const item = await addMedia(
        {
          blob: pending.blob,
          title: name,
          source: 'recording',
          fileName: serverFileName(name, extensionForMime(pending.mime)),
          language,
          durationSec: pending.durationSec,
          peaks: pending.peaks,
        },
        transcribeNow,
      );
      await closePending();
      navigate({ name: 'meeting', id: item.id });
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };

  return (
    <div className="review">
      <header>
        <h2>{t('review.heading')}</h2>
        <p className="muted">{t('review.eyebrow')}</p>
      </header>

      <MediaPlayer player={player} peaks={pending.peaks} kind="audio" />

      <div className="review-form">
        <label className="field">
          <span>{t('review.name')}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={150} />
        </label>
        <div className="field">
          <span>{t('review.language')}</span>
          <LanguageSelect value={language} onChange={setLanguage} label={t('review.language')} />
        </div>
      </div>

      <label className="switch">
        <input type="checkbox" checked={transcribeNow} onChange={(event) => setTranscribeNow(event.target.checked)} />
        <i aria-hidden />
        <span>{t('review.transcribeNow')}</span>
      </label>

      {failed && (
        <div className="banner banner-danger" role="alert">
          <AlertCircle size={18} aria-hidden />
          <span>{t('errors.storage')}</span>
        </div>
      )}

      <div className="review-actions">
        <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
          {busy && <Loader />}
          {transcribeNow ? t('review.saveAndTranscribe') : t('review.save')}
        </button>
        <button className="btn btn-gray" onClick={() => downloadBlob(pending.blob, serverFileName(title, extensionForMime(pending.mime)))}>
          <Download size={16} />
          {t('review.download')}
        </button>
        <ConfirmButton className="btn btn-plain" icon={<Trash2 size={16} />} label={t('review.discard')} confirmLabel={t('review.discardConfirm')} onConfirm={closePending} />
      </div>
    </div>
  );
}
