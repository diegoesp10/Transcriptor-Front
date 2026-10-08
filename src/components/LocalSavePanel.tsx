import { useState, type ReactNode } from 'react';
import { AlertCircle, Check, Download, FolderOpen, Trash2 } from 'lucide-react';
import { ApiError } from '../api/client';
import type { LibraryItem } from '../db/model';
import { useI18n } from '../i18n';
import { useFolder } from '../state/folder';
import { useLibrary } from '../state/library';
import { useToasts } from '../state/toasts';
import { localSaveErrorText } from '../utils/errors';
import { relativeTime } from '../utils/format';
import { ConfirmButton } from './ConfirmButton';
import { Loader } from './Loader';
import { Panel } from './Panel';

interface Props {
  item: LibraryItem;
  /** Hay un resumen generado y guardado en este navegador */
  hasSummary: boolean;
}

function Step({ index, done, title, children }: { index: number; done: boolean; title: string; children: ReactNode }) {
  return (
    <li className={`step ${done ? 'is-done' : ''}`}>
      <span className="step-mark" aria-hidden>
        {done ? <Check size={16} strokeWidth={3} /> : index}
      </span>
      <div className="step-body">
        <h3>{title}</h3>
        {children}
      </div>
    </li>
  );
}

/**
 * Flujo acordado con el backend, en tres pasos y siempre en este orden:
 *   1. guardar en la carpeta del usuario (o descargar, si el navegador no puede),
 *   2. (opcional) resumen con IA, que se incluye si ya existe,
 *   3. solo con los archivos a salvo, eliminar la copia temporal del servidor — acción manual e irreversible.
 */
export function LocalSavePanel({ item, hasSummary }: Props) {
  const { t, locale } = useI18n();
  const library = useLibrary();
  const folder = useFolder();
  const toast = useToasts();
  const [error, setError] = useState<string | null>(null);
  const progress = library.saving[item.id];

  const deleted = item.serverCopy === 'deleted';
  const saved = item.savedLocally;
  const expiresAt = item.temporaryExpiresAt ? new Date(item.temporaryExpiresAt) : null;
  const expired = expiresAt != null && expiresAt.getTime() < Date.now();
  const writable = Boolean(folder.handle) && folder.permission === 'granted';
  const summaryIncluded = saved ? saved.summaryIncluded : hasSummary;

  const fail = (caught: unknown) => setError(localSaveErrorText(caught, t));
  const saveToFolder = async () => {
    setError(null);
    try {
      await library.saveLocally(item.id);
      toast.push('success', t('local.autoSaved', { name: item.name, folder: folder.name ?? '' }));
    } catch (caught) {
      fail(caught);
    }
  };
  const download = async () => {
    setError(null);
    try {
      await library.downloadFiles(item.id);
    } catch (caught) {
      fail(caught);
    }
  };
  const removeServerCopy = async () => {
    setError(null);
    try {
      await library.confirmServerDelete(item.id);
      toast.push('success', t('local.deleted'));
    } catch (caught) {
      setError(caught instanceof ApiError && caught.status === 409 ? t('errors.conflict') : localSaveErrorText(caught, t));
    }
  };

  let step1: ReactNode;
  if (saved) {
    step1 = (
      <>
        <p className="step-done">
          {saved.rootName ? t('local.step1Done', { root: saved.rootName, folder: saved.folderName }) : t('local.step1DoneDownloads', { count: saved.files.length })}
        </p>
        <p className="muted small mono">{t('local.savedFiles', { files: saved.files.join(', ') })}</p>
      </>
    );
  } else {
    step1 = <p className="muted">{t('local.step1Hint')}</p>;
  }

  const showSaveAction = !deleted;
  let step1Action: ReactNode = null;
  if (showSaveAction) {
    if (!folder.supported) {
      step1Action = (
        <button className="btn btn-primary" onClick={() => void download()} disabled={Boolean(progress)}>
          {progress ? <Loader /> : <Download size={16} />}
          {t('local.download')}
        </button>
      );
    } else if (!folder.handle) {
      step1Action = (
        <button className="btn btn-primary" onClick={() => void folder.choose().catch(fail)}>
          <FolderOpen size={16} />
          {t('local.choose')}
        </button>
      );
    } else if (!writable) {
      step1Action = (
        <button className="btn btn-primary" onClick={() => void folder.renew()}>
          {t('local.renew')}
        </button>
      );
    } else {
      step1Action = (
        <button className="btn btn-primary" onClick={() => void saveToFolder()} disabled={Boolean(progress)}>
          {progress ? <Loader /> : <FolderOpen size={16} />}
          {progress ? (progress.total > 0 ? t('local.saving', { done: progress.done, total: progress.total }) : t('local.savingStart')) : saved ? t('local.saveAgain') : t('local.save')}
        </button>
      );
    }
  }

  return (
    <Panel className="local-panel" title={t('local.panelTitle')} aside={saved ? 'OK' : undefined}>
      <p className={`local-status ${expired && !deleted ? 'is-expired' : ''}`}>
        {deleted ? t('local.serverDeleted') : expiresAt ? (expired ? t('local.expired') : t('local.expires', { when: relativeTime(expiresAt.toISOString(), locale) })) : null}
      </p>

      <ol className="steps">
        <Step index={1} done={Boolean(saved)} title={t('local.step1')}>
          {step1}
          {step1Action && <div className="step-actions">{step1Action}</div>}
        </Step>

        <Step index={2} done={summaryIncluded} title={t('local.step2')}>
          <p className="muted">{t('local.step2Hint')}</p>
          <p className="small">
            <b>{summaryIncluded ? t('local.summaryIn') : t('local.summaryOut')}</b>
          </p>
        </Step>

        <Step index={3} done={deleted} title={t('local.step3')}>
          <p className="muted">{deleted ? t('local.deleted') : t('local.step3Hint')}</p>
          {!deleted && (
            <div className="step-actions">
              <ConfirmButton
                className="btn btn-danger-text"
                icon={<Trash2 size={16} />}
                label={t('local.delete')}
                confirmLabel={t('local.deleteConfirm')}
                disabled={!saved}
                onConfirm={removeServerCopy}
              />
              {!saved && <span className="muted small">{t('local.deleteLocked')}</span>}
            </div>
          )}
        </Step>
      </ol>

      {error && (
        <div className="banner banner-danger" role="alert">
          <AlertCircle size={18} aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </Panel>
  );
}
