import type { LibraryItem } from '../db/model';
import { useI18n, type MessageKey } from '../i18n';
import { useLibrary, useLiveJob } from '../state/library';
import { jobProgress } from '../utils/progress';

/** Texto y fracción (0‑1, o null si no se puede medir) del trabajo en curso de un elemento */
export function useItemProgress(item: LibraryItem): { fraction: number | null; label: string } | null {
  const { t } = useI18n();
  const { progress } = useLibrary();
  const job = useLiveJob(item.id);
  switch (item.status) {
    case 'uploading': {
      const fraction = progress[item.id] ?? 0;
      return { fraction, label: t('progress.uploading', { percent: Math.round(fraction * 100) }) };
    }
    case 'Queued':
    case 'Processing': {
      // La barra es la de la fase actual (es lo que mide el servidor); el texto dice qué fase es
      const state = jobProgress(item, job?.progress ?? null);
      const step = t(`live.step.${state.step}` as MessageKey);
      const parts = [step];
      if (state.step === 'transcribing' && state.totalChunks > 1 && state.chunkNumber != null) {
        parts.push(t('live.chunk', { n: Math.min(state.chunkNumber, state.totalChunks), total: state.totalChunks }));
      }
      if (state.fraction != null) parts.push(`${Math.round(state.fraction * 100)} %`);
      return { fraction: state.fraction, label: parts.join(' · ') };
    }
    default:
      return null;
  }
}
