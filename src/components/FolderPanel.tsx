import { useState } from 'react';
import { FolderOpen, Info } from 'lucide-react';
import { Loader } from './Loader';
import { Panel } from './Panel';
import { useI18n } from '../i18n';
import { useFolder } from '../state/folder';
import { useToasts } from '../state/toasts';
import { localSaveErrorText } from '../utils/errors';

interface Props {
  /** studio: invitación a elegir la carpeta (sin carpeta, llama la atención) · settings: además permite olvidarla */
  variant: 'studio' | 'settings';
}

/**
 * Destino final de las reuniones: una carpeta del ordenador del usuario (File System Access API). El selector del sistema
 * solo se abre desde un clic directo, por eso los manejadores llaman a folder.choose()/renew() sin esperar nada antes.
 */
export function FolderPanel({ variant }: Props) {
  const { t } = useI18n();
  const folder = useFolder();
  const toast = useToasts();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.push('error', localSaveErrorText(error, t));
    } finally {
      setBusy(false);
    }
  };

  if (!folder.supported) {
    return (
      <Panel title={t('local.window')} className="folder-panel">
        <p className="note">
          <Info size={16} aria-hidden />
          {t('local.unsupported')}
        </p>
      </Panel>
    );
  }

  if (!folder.ready) {
    return (
      <Panel title={t('local.window')} className="folder-panel">
        <div className="state-center">
          <Loader size={22} />
        </div>
      </Panel>
    );
  }

  // Sin carpeta: es lo primero que debe resolver el usuario, así que se presenta como una pregunta
  if (!folder.handle) {
    return (
      <Panel title={t('local.window')} className="folder-panel is-ask">
        <div className="folder-ask">
          <span className="folder-tile tint-blue lg"><FolderOpen size={30} strokeWidth={1.75} /></span>
          <div>
            <h3>{t('local.askTitle')}</h3>
            <p>{t('local.askText')}</p>
            <button className="btn btn-primary" disabled={busy} onClick={() => void run(folder.choose)}>
              {busy && <Loader />}
              {t('local.choose')}
            </button>
          </div>
        </div>
      </Panel>
    );
  }

  const granted = folder.permission === 'granted';
  return (
    <Panel title={t('local.window')} className={`folder-panel ${granted ? '' : 'is-warn'}`}>
      <div className="folder-current">
        <span className="folder-tile tint-blue"><FolderOpen size={22} strokeWidth={1.75} /></span>
        <div className="folder-name">
          <small>{t('local.current')}</small>
          <b title={folder.name ?? undefined}>{folder.name}</b>
        </div>
      </div>

      {!granted && (
        <p className="note note-warn">
          <Info size={16} aria-hidden />
          {folder.permission === 'denied' ? t('local.denied', { name: folder.name ?? '' }) : t('local.needsPermission', { name: folder.name ?? '' })}
        </p>
      )}

      <div className="folder-actions">
        {!granted && folder.permission !== 'denied' && (
          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => void run(folder.renew)}>
            {t('local.renew')}
          </button>
        )}
        <button className="btn btn-sm" disabled={busy} onClick={() => void run(folder.choose)}>
          {t('local.change')}
        </button>
        {variant === 'settings' && (
          <button className="btn btn-plain btn-sm" onClick={() => void folder.forget()}>
            {t('local.forget')}
          </button>
        )}
      </div>
    </Panel>
  );
}
