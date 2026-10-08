import { AudioLines, Film, FolderCheck, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import type { LibraryItem } from '../db/model';
import { useItemProgress } from '../hooks/useItemProgress';
import { useI18n } from '../i18n';
import { hrefOf } from '../state/route';
import { useLibrary } from '../state/library';
import { formatBytes, formatDuration, relativeTime } from '../utils/format';
import { ConfirmButton } from './ConfirmButton';
import { Panel } from './Panel';
import { StatusBadge } from './StatusBadge';
import { Waveform } from './Waveform';

/**
 * Tarjeta de la biblioteca: icono tintado, nombre, estado y la onda. El título es el enlace (se estira por toda la tarjeta);
 * los botones van por encima.
 */
export function ItemCard({ item }: { item: LibraryItem }) {
  const { t, locale, lang } = useI18n();
  const { transcribe, cancelUpload, retry, remove } = useLibrary();
  const progress = useItemProgress(item);
  const canStart = item.status === 'local' && item.hasMedia;
  const canRetry = item.status === 'uploadFailed' || item.status === 'Failed';
  const KindIcon = item.kind === 'video' ? Film : AudioLines;

  return (
    <Panel as="article" className={`item status-${item.status}`}>
      <div className="item-head">
        <span className={`item-icon ${item.kind === 'video' ? 'tint-purple' : 'tint-blue'}`} aria-hidden>
          <KindIcon size={22} strokeWidth={1.75} />
        </span>
        <div className="item-title">
          <h3>
            <a className="stretched" href={hrefOf({ name: 'meeting', id: item.id })}>
              {item.name}
            </a>
          </h3>
          <time dateTime={item.createdAt} title={new Date(item.createdAt).toLocaleString(locale)}>
            {relativeTime(item.createdAt, locale)}
          </time>
        </div>
      </div>

      <div className="item-badges">
        <StatusBadge status={item.status} />
        {item.savedLocally && (
          <span className="badge tint-green">
            <FolderCheck size={13} strokeWidth={2.25} aria-hidden />
            {item.savedLocally.rootName ? t('local.folderBadge') : t('local.downloadBadge')}
          </span>
        )}
      </div>

      <div className="item-body">
        {progress ? (
          <div className="item-progress">
            <div
              className={`progress ${progress.fraction == null ? 'is-indeterminate' : ''}`}
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress.fraction == null ? undefined : Math.round(progress.fraction * 100)}
            >
              <i style={{ width: progress.fraction == null ? undefined : `${Math.max(2, progress.fraction * 100)}%` }} />
            </div>
            <span>{progress.label}</span>
          </div>
        ) : item.peaks ? (
          <Waveform peaks={item.peaks} progress={item.status === 'Completed' ? 1 : 0} className="item-wave" />
        ) : (
          <p className="item-note">{item.status === 'Failed' ? t('card.failedNote') : item.hasMedia ? t('card.noWave') : t('card.remoteNote')}</p>
        )}
      </div>

      <footer className="item-foot">
        <ul className="meta" aria-label={t('card.details')}>
          {item.durationSec != null && <li className="mono">{formatDuration(item.durationSec)}</li>}
          {item.size > 0 && <li>{formatBytes(item.size, locale)}</li>}
          <li>{new Intl.DisplayNames([lang], { type: 'language' }).of(item.language) ?? item.language}</li>
        </ul>
        <div className="item-actions">
          {canStart && (
            <button className="btn btn-primary btn-sm" onClick={() => transcribe(item.id)}>
              <Sparkles size={15} />
              {t('card.transcribe')}
            </button>
          )}
          {canRetry && (
            <button className="btn btn-gray btn-sm" onClick={() => void retry(item.id)}>
              <RefreshCw size={15} />
              {t('card.retry')}
            </button>
          )}
          {item.status === 'uploading' && (
            <button className="btn btn-gray btn-sm" onClick={() => cancelUpload(item.id)}>
              <X size={15} />
              {t('card.cancel')}
            </button>
          )}
          <ConfirmButton
            className="icon-btn icon-btn-danger"
            iconOnly
            icon={<Trash2 size={17} />}
            label={t('card.delete')}
            confirmLabel={t('card.deleteConfirm')}
            onConfirm={() => remove(item.id)}
          />
        </div>
      </footer>
    </Panel>
  );
}
