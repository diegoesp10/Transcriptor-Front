import type { ReactNode } from 'react';
import { Braces, Captions, ChevronDown, Copy, Download, FileAudio, FileText, FileType, Server } from 'lucide-react';
import { usePopover } from '../hooks/usePopover';
import { useI18n, type MessageKey } from '../i18n';
import type { ExportFormat } from '../utils/exporters';

interface Props {
  onExport: (format: ExportFormat) => void;
  onCopy: () => void;
  /** TXT tal como lo genera el servidor (GET /transcript.txt) */
  onServerTxt?: () => void;
  /** Descarga del audio/vídeo original guardado en el navegador; ausente si no hay copia local */
  onMedia?: () => void;
}

const FORMATS: { id: ExportFormat; icon: ReactNode; label: MessageKey; hint: MessageKey }[] = [
  { id: 'txt', icon: <FileText size={18} />, label: 'export.txt', hint: 'export.txtHint' },
  { id: 'md', icon: <FileType size={18} />, label: 'export.md', hint: 'export.mdHint' },
  { id: 'srt', icon: <Captions size={18} />, label: 'export.srt', hint: 'export.srtHint' },
  { id: 'vtt', icon: <Captions size={18} />, label: 'export.vtt', hint: 'export.vttHint' },
  { id: 'json', icon: <Braces size={18} />, label: 'export.json', hint: 'export.jsonHint' },
];

/** Menú de descargas: formatos generados en el navegador, copiar, TXT del servidor y audio original */
export function ExportMenu({ onExport, onCopy, onServerTxt, onMedia }: Props) {
  const { t } = useI18n();
  const { open, setOpen, ref } = usePopover();
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-primary" onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        <Download size={16} />
        {t('export.button')}
        <ChevronDown size={15} className={open ? 'flip' : ''} />
      </button>
      {open && (
        <div className="menu-panel popover glass" role="menu">
          <p className="menu-title">{t('export.title')}</p>
          {FORMATS.map((format) => (
            <button key={format.id} role="menuitem" className="menu-item" onClick={run(() => onExport(format.id))}>
              {format.icon}
              <span>
                <b>{t(format.label)}</b>
                <small>{t(format.hint)}</small>
              </span>
            </button>
          ))}
          <hr />
          <button role="menuitem" className="menu-item" onClick={run(onCopy)}>
            <Copy size={18} />
            <span>
              <b>{t('export.copy')}</b>
              <small>{t('export.copyHint')}</small>
            </span>
          </button>
          {onServerTxt && (
            <button role="menuitem" className="menu-item" onClick={run(onServerTxt)}>
              <Server size={18} />
              <span>
                <b>{t('export.server')}</b>
                <small>{t('export.serverHint')}</small>
              </span>
            </button>
          )}
          {onMedia && (
            <button role="menuitem" className="menu-item" onClick={run(onMedia)}>
              <FileAudio size={18} />
              <span>
                <b>{t('export.media')}</b>
                <small>{t('export.mediaHint')}</small>
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
