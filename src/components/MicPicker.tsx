import { useEffect, useState } from 'react';
import { ChevronsUpDown, Info, Mic } from 'lucide-react';
import { useMicrophones, useMicTest } from '../hooks/useMicrophones';
import { usePrefs } from '../hooks/usePrefs';
import { useI18n } from '../i18n';
import { LevelMeter } from './LevelMeter';

interface Props {
  /** true mientras se graba: el micrófono no se puede cambiar ni probar */
  disabled?: boolean;
}

/**
 * Selector del micrófono que se usará al grabar, con prueba de nivel. La elección se guarda en este navegador y se
 * aplica a todas las sesiones; si el dispositivo ya no existe cuando se graba, se usa el predeterminado y se avisa.
 */
export function MicPicker({ disabled }: Props) {
  const { t } = useI18n();
  const { prefs, update } = usePrefs();
  const mics = useMicrophones();
  const [testing, setTesting] = useState(false);
  const test = useMicTest(prefs.micId, testing && !disabled);

  // Al empezar a grabar o desmontar, la prueba se apaga sola
  useEffect(() => {
    if (disabled) setTesting(false);
  }, [disabled]);

  if (!mics.supported) {
    return (
      <p className="note">
        <Info size={16} aria-hidden />
        {t('mic.unsupported')}
      </p>
    );
  }

  // «default» es un alias del dispositivo predeterminado: se presenta como la opción vacía, con su nombre
  const real = mics.devices.filter((device) => device.id !== 'default' && device.id !== '');
  const systemDefault = mics.devices.find((device) => device.id === 'default');
  const defaultName = (systemDefault?.label ?? '').replace(/^(default|predeterminado)\s*[-–:]\s*/i, '');
  const selected = prefs.micId;
  const missing = selected !== '' && mics.labelled && !real.some((device) => device.id === selected);

  if (!mics.labelled) {
    return (
      <div className="mic-picker">
        <div className="list-row">
          <span className="row-icon tint-blue">
            <Mic size={18} />
          </span>
          <span className="row-text">
            <b>{t('mic.label')}</b>
            <small>{mics.access === 'denied' ? t('mic.denied') : t('mic.grantHint')}</small>
          </span>
          {mics.access !== 'denied' && (
            <button className="btn btn-tinted btn-sm" onClick={() => void mics.grantAccess()} disabled={disabled}>
              {t('mic.grant')}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mic-picker">
      <label className="list-row">
        <span className="row-icon tint-blue">
          <Mic size={18} />
        </span>
        <span className="row-text">
          <b>{t('mic.label')}</b>
          <small>{t('mic.count', { count: real.length })}</small>
        </span>
        <span className="row-select">
          <select value={selected} disabled={disabled} onChange={(event) => update({ micId: event.target.value })} aria-label={t('mic.label')}>
            <option value="">{defaultName ? t('mic.defaultNamed', { name: defaultName }) : t('mic.default')}</option>
            {missing && <option value={selected}>{t('mic.missing')}</option>}
            {real.map((device, index) => (
              <option key={device.id} value={device.id}>
                {device.label || t('mic.unnamed', { n: index + 1 })}
              </option>
            ))}
          </select>
          <ChevronsUpDown size={14} aria-hidden />
        </span>
      </label>

      {missing && (
        <p className="note note-warn">
          <Info size={16} aria-hidden />
          {t('mic.missingNote')}
        </p>
      )}

      <div className="mic-test">
        <button className="btn btn-gray btn-sm" onClick={() => setTesting((value) => !value)} disabled={disabled}>
          {testing ? t('mic.testStop') : t('mic.test')}
        </button>
        <LevelMeter levelRef={test.levelRef} live={test.state === 'on'} label={t('mic.level')} />
        <span className="mic-test-state">
          {test.state === 'starting' ? t('mic.testStarting') : test.state === 'error' ? t('mic.testError') : test.state === 'on' ? t('mic.testing') : ''}
        </span>
      </div>
    </div>
  );
}
