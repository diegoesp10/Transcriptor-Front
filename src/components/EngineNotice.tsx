import { TriangleAlert } from 'lucide-react';
import { useI18n } from '../i18n';
import { useEngine } from '../state/engine';
import { codeText } from '../utils/errors';

/**
 * Aviso cuando el servidor dice que ahora no puede transcribir (falta el modelo de Whisper, FFmpeg o la diarización).
 * La subida y el reintento devolverían 503, así que se avisa antes. No se pinta nada si todo está listo o no se sabe.
 */
export function EngineNotice() {
  const { t } = useI18n();
  const { config } = useEngine();
  if (!config || config.ready) return null;
  return (
    <div className="banner banner-warn" role="status">
      <TriangleAlert size={18} aria-hidden />
      <span>
        {t('engine.notReady')} {codeText(config.errorCode, t) ?? ''}
      </span>
    </div>
  );
}
