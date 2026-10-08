import { useRef, type CSSProperties } from 'react';
import { AudioWaveform, Check, Clock, FileCheck2, Sparkles, UserRound, Users } from 'lucide-react';
import type { SpeakerIdentityDto } from '../api/types';
import type { LibraryItem } from '../db/model';
import { useI18n, type MessageKey } from '../i18n';
import { useEngine } from '../state/engine';
import { useLiveJob } from '../state/library';
import { formatDuration } from '../utils/format';
import { EtaEstimator, jobProgress, STEPS, type JobProgress, type Step } from '../utils/progress';
import { Loader } from './Loader';
import { Panel } from './Panel';
import { ProcessingArt } from './ProcessingArt';

const STEP_ICON = { queued: Clock, preparing: AudioWaveform, diarizing: Users, transcribing: AudioWaveform, naming: UserRound, saving: FileCheck2 } as const;

/**
 * Progreso de una transcripción en curso, sincronizado con el servidor: la fase actual con su porcentaje (el de la fase,
 * no uno total inventado), el resto de fases, el tiempo que lleva, el audio ya procesado y las voces detectadas. Con el
 * flujo en directo se actualiza cada 2 segundos; sin él, con el sondeo.
 */
export function LiveProgress({ item }: { item: LibraryItem }) {
  const { t } = useI18n();
  const job = useLiveJob(item.id, true);
  const { config } = useEngine();
  const progress = jobProgress(item, job?.progress ?? null);
  const live = job?.channel === 'stream';

  const estimator = useRef(new EtaEstimator());
  const eta = estimator.current.estimate(progress.step === 'transcribing' && progress.stage === 'Transcribing' ? progress.fraction : null);

  // La detección de hablantes se muestra salvo que el servidor diga que está desactivada
  const steps = STEPS.filter((step) => step !== 'diarizing' || config?.diarizationEnabled !== false || progress.step === 'diarizing');
  const currentIndex = steps.indexOf(progress.step);
  const percent = progress.fraction == null ? null : Math.round(progress.fraction * 100);
  const StepIcon = STEP_ICON[progress.step];

  return (
    <div className="live-progress">
      <Panel className="state-panel live-head" title={t('status.Processing')} aside={<ChannelChip live={live} />}>
        <ProcessingArt fraction={progress.fraction}>
          {percent == null ? <StepIcon size={34} strokeWidth={1.6} className="ring-icon" aria-hidden /> : <b className="ring-percent">{percent}%</b>}
        </ProcessingArt>
        <div className="state-text">
          <h2>{t(`live.step.${progress.step}` as MessageKey)}</h2>
          <p className="lede">{detailOf(progress, t)}</p>
          <p className="live-meta">
            {progress.elapsedSeconds != null && <span>{t('live.elapsed', { time: formatDuration(progress.elapsedSeconds) })}</span>}
            {eta != null && <span>{eta < 60 ? t('live.etaUnderMinute') : t('live.etaMinutes', { count: Math.ceil(eta / 60) })}</span>}
          </p>
          <p className="muted">{t('meeting.processingHint')}</p>
        </div>
      </Panel>

      <Panel className="live-steps-panel" title={t('live.steps')}>
        <ol className="live-steps">
          <StepRow state="done" label={t('live.uploaded')} />
          {steps.map((step, index) => {
            const state = index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'pending';
            return (
              <StepRow
                key={step}
                state={state}
                label={t(`live.step.${step}` as MessageKey)}
                hint={state === 'current' ? detailOf(progress, t) : null}
                fraction={state === 'current' ? progress.fraction : null}
                aside={step === 'transcribing' && progress.totalChunks > 0 ? `${Math.min(progress.completedChunks, progress.totalChunks)}/${progress.totalChunks}` : null}
              />
            );
          })}
        </ol>
      </Panel>

      {progress.speakers && <DetectedSpeakers speakers={progress.speakers} step={progress.step} />}
    </div>
  );
}

/** Texto de detalle de la fase: el paso de la detección de hablantes, el fragmento y el audio procesado… */
function detailOf(progress: JobProgress, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  if (progress.stage === 'DetectingSpeakers' && progress.substep) return t(`live.substep.${progress.substep}` as MessageKey);
  if (progress.step === 'transcribing' && progress.stage !== 'LoadingTranscriptionModel') {
    const parts: string[] = [];
    if (progress.totalChunks > 0 && progress.chunkNumber != null) parts.push(t('live.chunk', { n: Math.min(progress.chunkNumber, progress.totalChunks), total: progress.totalChunks }));
    if (progress.processedAudioSeconds != null && progress.audioDurationSeconds) {
      parts.push(t('live.audio', { done: formatDuration(progress.processedAudioSeconds), total: formatDuration(progress.audioDurationSeconds) }));
    }
    if (parts.length > 0) return parts.join(' · ');
  }
  return t(`live.detail.${progress.stage ?? progress.step}` as MessageKey);
}

function ChannelChip({ live }: { live: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`live-chip ${live ? 'is-live' : ''}`} title={live ? t('live.channelLiveHint') : t('live.channelPollHint')}>
      <i aria-hidden />
      {live ? t('live.channelLive') : t('live.channelPoll')}
    </span>
  );
}

function StepRow({ state, label, hint, fraction, aside }: { state: 'done' | 'current' | 'pending'; label: string; hint?: string | null; fraction?: number | null; aside?: string | null }) {
  return (
    <li className={`live-step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
      <span className="live-step-mark" aria-hidden>
        {state === 'done' ? <Check size={13} strokeWidth={3} /> : state === 'current' ? <Loader size={16} /> : <i />}
      </span>
      <span className="live-step-text">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
        {state === 'current' && fraction != null && (
          <span className="progress live-step-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(fraction * 100)}>
            <i style={{ width: `${Math.max(2, fraction * 100)}%` }} />
          </span>
        )}
      </span>
      {aside && <span className="live-step-aside mono">{aside}</span>}
    </li>
  );
}

/** Voces que el servidor ya ha separado y, si alguien se presentó («me llamo…»), su nombre */
function DetectedSpeakers({ speakers, step }: { speakers: SpeakerIdentityDto[]; step: Step }) {
  const { t } = useI18n();
  const before = STEPS.indexOf(step) <= STEPS.indexOf('diarizing');
  return (
    <Panel className="live-speakers-panel" title={t('live.speakersTitle')} aside={speakers.length > 0 ? t('live.speakersCount', { count: speakers.length }) : undefined}>
      {speakers.length === 0 ? (
        <p className="muted live-preview-empty">{before ? t('live.speakersPending') : t('live.speakersNone')}</p>
      ) : (
        <ul className="live-speakers">
          {speakers.map((speaker, index) => {
            // "Hablante 2" → "Speaker 2" en inglés; una etiqueta que no siga ese formato se muestra tal cual
            const number = /^Hablante (\d+)$/.exec(speaker.speakerId)?.[1];
            const label = number ? t('speaker.numbered', { n: number }) : speaker.displayName;
            return (
            <li key={speaker.speakerId} style={{ '--spk': `var(--spk-${index % 8})` } as CSSProperties}>
              <i aria-hidden />
              <span className="live-speaker-text">
                <b>{speaker.name ?? label}</b>
                {speaker.name && <small>{label}</small>}
              </span>
              {speaker.nameSource === 'SelfIntroduction' && (
                <span className="badge tint-blue" title={t('live.introducedHint')}>
                  <Sparkles size={12} aria-hidden />
                  {t('live.introduced')}
                </span>
              )}
            </li>
            );
          })}
        </ul>
      )}
      <p className="muted small">{t('live.speakersNote')}</p>
    </Panel>
  );
}
