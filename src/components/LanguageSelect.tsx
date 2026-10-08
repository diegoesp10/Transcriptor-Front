import { useMemo } from 'react';
import { Languages } from 'lucide-react';
import { TRANSCRIPTION_LANGUAGES, useI18n } from '../i18n';
import { PickerMenu, type PickerOption } from './PickerMenu';

interface Props {
  value: string;
  onChange: (language: string) => void;
  label: string;
  disabled?: boolean;
  /** Lado al que se abre el menú: `end` si el selector está a la derecha (filas), `start` si está a la izquierda */
  align?: 'start' | 'end';
  className?: string;
}

const capitalize = (text: string, locale: string) => text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);

/**
 * Selector del idioma del AUDIO (el que se envía a la API): el mismo botón y menú que el del micrófono. Cada idioma va con
 * su código y, debajo, su nombre en su propia lengua (Español → «English» para Inglés), para encontrarlo en cualquier interfaz.
 */
export function LanguageSelect({ value, onChange, label, disabled, align, className }: Props) {
  const { t, locale } = useI18n();
  const options = useMemo<PickerOption<string>[]>(() => {
    const names = new Intl.DisplayNames([locale], { type: 'language' });
    const codes = TRANSCRIPTION_LANGUAGES.includes(value as never) ? [...TRANSCRIPTION_LANGUAGES] : [value, ...TRANSCRIPTION_LANGUAGES];
    return codes.map((code) => {
      const name = capitalize(names.of(code) ?? code, locale);
      const own = capitalize(new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code, code);
      return { value: code, label: name, hint: own !== name ? own : undefined, code: code.toUpperCase() };
    });
  }, [locale, value]);

  return <PickerMenu value={value} options={options} onChange={onChange} label={label} menuTitle={t('recorder.languageMenu')} icon={Languages} disabled={disabled} align={align} className={className} />;
}
