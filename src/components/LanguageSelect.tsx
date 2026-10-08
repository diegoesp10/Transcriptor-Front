import { useMemo } from 'react';
import { ChevronDown, Languages } from 'lucide-react';
import { TRANSCRIPTION_LANGUAGES, useI18n } from '../i18n';

interface Props {
  value: string;
  onChange: (language: string) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Selector del idioma del AUDIO (el que se envía a la API), con los nombres en el idioma de la interfaz */
export function LanguageSelect({ value, onChange, label, disabled, className = '' }: Props) {
  const { locale } = useI18n();
  const options = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'language' });
    const codes = TRANSCRIPTION_LANGUAGES.includes(value as never) ? [...TRANSCRIPTION_LANGUAGES] : [value, ...TRANSCRIPTION_LANGUAGES];
    return codes.map((code) => {
      const name = names.of(code) ?? code;
      return { code, name: name.charAt(0).toLocaleUpperCase(locale) + name.slice(1) };
    });
  }, [locale, value]);

  return (
    <label className={`select ${className}`}>
      <Languages size={16} aria-hidden />
      <span className="sr-only">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} aria-label={label}>
        {options.map((option) => (
          <option key={option.code} value={option.code}>
            {option.name}
          </option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden />
    </label>
  );
}
