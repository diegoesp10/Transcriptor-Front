import { useRef, useState, type DragEvent } from 'react';
import { AudioLines } from 'lucide-react';
import { useI18n } from '../i18n';
import { SUPPORTED_EXTENSIONS } from '../utils/media';
import { Panel } from './Panel';

interface Props {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
}

const ACCEPT = ['audio/*', 'video/*', ...SUPPORTED_EXTENSIONS].join(',');

/** Zona para soltar audios y vídeos (o elegirlos con el selector del sistema). Al arrastrar encima se resalta en azul. */
export function Dropzone({ onFiles, disabled }: Props) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/dragleave se disparan también al cruzar hijos

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    if (disabled) return;
    const files = [...event.dataTransfer.files];
    if (files.length > 0) onFiles(files);
  };

  return (
    <Panel title={t('dropzone.window')} className={`dropzone ${over ? 'is-over' : ''}`}>
      <div
        className="dropzone-target"
        onDragEnter={(event) => {
          event.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragLeave={() => {
          if (--depth.current <= 0) setOver(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={onDrop}
      >
        <span className="dropzone-icon tint-blue" aria-hidden>
          <AudioLines size={28} strokeWidth={1.75} />
        </span>
        <h3>{t('dropzone.title')}</h3>
        <p>{t('dropzone.hint')}</p>
        <button className="btn btn-tinted" onClick={() => input.current?.click()} disabled={disabled}>
          {t('dropzone.choose')}
        </button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = ''; // permite volver a elegir el mismo archivo
            if (files.length > 0) onFiles(files);
          }}
        />
        <div className="dropzone-formats" aria-label={t('dropzone.formats')}>
          {SUPPORTED_EXTENSIONS.map((ext) => (
            <code key={ext}>{ext.slice(1)}</code>
          ))}
        </div>
      </div>
    </Panel>
  );
}
