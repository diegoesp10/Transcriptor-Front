import type { LibraryItem } from '../db/model';
import { useI18n } from '../i18n';
import { useLibrary } from '../state/library';

/** Texto y fracción (0‑1, o null si no se puede medir) del trabajo en curso de un elemento */
export function useItemProgress(item: LibraryItem): { fraction: number | null; label: string } | null {
  const { t } = useI18n();
  const { progress } = useLibrary();
  switch (item.status) {
    case 'uploading': {
      const fraction = progress[item.id] ?? 0;
      return { fraction, label: t('progress.uploading', { percent: Math.round(fraction * 100) }) };
    }
    case 'Queued':
      return { fraction: null, label: t('progress.queued') };
    case 'Processing':
      return item.totalChunks > 0
        ? { fraction: item.completedChunks / item.totalChunks, label: t('progress.processing', { done: item.completedChunks, total: item.totalChunks }) }
        : { fraction: null, label: t('progress.preparing') };
    default:
      return null;
  }
}
