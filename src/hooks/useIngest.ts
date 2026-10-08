import { useCallback } from 'react';
import { useI18n } from '../i18n';
import { useLibrary } from '../state/library';
import { useToasts } from '../state/toasts';
import type { LibraryItem } from '../db/model';
import { computePeaks, extensionOf, kindOf, probeDuration, serverFileName, stripExtension, validateFile } from '../utils/media';
import { usePrefs } from './usePrefs';

/**
 * Entrada de archivos (arrastrados o elegidos): valida como lo hará el backend, mide duración y onda, los guarda en la
 * biblioteca y, según la preferencia, los envía a transcribir. Devuelve los elementos creados.
 */
export function useIngest() {
  const { t } = useI18n();
  const { addMedia } = useLibrary();
  const { prefs } = usePrefs();
  const toast = useToasts();

  return useCallback(
    async (files: File[], language = prefs.language): Promise<LibraryItem[]> => {
      const created: LibraryItem[] = [];
      for (const file of files) {
        const problem = validateFile(file);
        if (problem) {
          toast.push('error', `${file.name}: ${t(`upload.reject.${problem}`)}`);
          continue;
        }
        try {
          const kind = kindOf(file.name, file.type);
          const [durationSec, peaks] = await Promise.all([probeDuration(file, kind), computePeaks(file)]);
          const title = stripExtension(file.name);
          created.push(
            await addMedia(
              { blob: file, title, source: 'upload', fileName: serverFileName(title, extensionOf(file.name)), language, durationSec, peaks },
              prefs.autoTranscribe,
            ),
          );
        } catch {
          toast.push('error', `${file.name}: ${t('errors.storage')}`);
        }
      }
      if (created.length > 0) toast.push('success', t('upload.added', { count: created.length }));
      return created;
    },
    [addMedia, prefs.autoTranscribe, prefs.language, t, toast],
  );
}
