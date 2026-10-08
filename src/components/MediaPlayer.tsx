import { Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { useI18n } from '../i18n';
import type { MediaPlayerState } from '../hooks/useMediaPlayer';
import { formatDuration } from '../utils/format';
import { Waveform } from './Waveform';
import { Panel } from './Panel';

interface Props {
  player: MediaPlayerState;
  peaks: number[] | null;
  kind: 'audio' | 'video';
}

/** Reproductor: reproducción, saltos de 15 s, velocidad y la onda para moverse por el audio. Flotante y de vidrio en la reunión. */
export function MediaPlayer({ player, peaks, kind }: Props) {
  const { t } = useI18n();
  const { time, duration, playing, rate } = player;
  const progress = duration > 0 ? time / duration : 0;

  return (
    <Panel className="player" label={t('player.label')} flush>
      {/* El elemento siempre existe (es el que reproduce); solo se ve si el archivo es un vídeo */}
      <div className="player-inner">
      <video {...player.mediaProps} className={`player-video ${kind === 'video' ? '' : 'is-hidden'}`} aria-hidden={kind !== 'video'} />
      <div className="player-row">
        <div className="player-controls">
          <button className="icon-btn" onClick={() => player.skip(-15)} aria-label={t('player.back')} title={t('player.back')}>
            <RotateCcw size={18} />
          </button>
          <button className="play-btn" onClick={player.toggle} aria-label={playing ? t('player.pause') : t('player.play')}>
            {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
          </button>
          <button className="icon-btn" onClick={() => player.skip(15)} aria-label={t('player.forward')} title={t('player.forward')}>
            <RotateCw size={18} />
          </button>
        </div>
        <span className="mono player-time">{formatDuration(time)}</span>
        <Waveform
          peaks={peaks}
          progress={progress}
          onSeek={(fraction) => player.seek(fraction * duration)}
          label={t('player.seek')}
          className="player-wave"
        />
        <span className="mono player-time player-total">{formatDuration(duration)}</span>
        <button className="chip-btn mono" onClick={player.cycleRate} aria-label={t('player.speed')} title={t('player.speed')}>
          {rate}×
        </button>
      </div>
      </div>
    </Panel>
  );
}
