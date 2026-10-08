import { useEffect, useState, type ReactNode } from 'react';
import { Headphones, Info, Laptop, Mic, Play, Square, Usb, Webcam, type LucideIcon } from 'lucide-react';
import { useMicrophones, useMicTest } from '../hooks/useMicrophones';
import { usePrefs } from '../hooks/usePrefs';
import { useI18n } from '../i18n';
import { LevelMeter } from './LevelMeter';
import { PickerMenu, type PickerOption } from './PickerMenu';

interface Props {
  /** true mientras se graba: el micrófono no se puede cambiar ni probar */
  disabled?: boolean;
  /** Solo las filas, sin tarjeta propia: para meterlas en una tarjeta agrupada con otros ajustes (la grabadora) */
  embedded?: boolean;
}

/** Quita el «(046d:0825)» de fabricante que Chrome añade a los dispositivos USB */
const cleanLabel = (label: string) => label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();

/** Icono según el tipo de dispositivo que sugiere su nombre */
function iconFor(label: string): LucideIcon {
  if (/airpods|buds|headset|headphone|auricular|cascos|bluetooth|hands-free|manos libres/i.test(label)) return Headphones;
  if (/webcam|camera|cámara|brio|c9\d\d|facetime/i.test(label)) return Webcam;
  if (/usb|yeti|rode|shure|focusrite|scarlett|audio interface|interfaz/i.test(label)) return Usb;
  if (/array|integrated|internal|interno|integrado|built-in|macbook|laptop/i.test(label)) return Laptop;
  return Mic;
}

/**
 * Selector del micrófono que se usará al grabar, con prueba de nivel. La elección se guarda en este navegador y se
 * aplica a todas las sesiones; si el dispositivo ya no existe cuando se graba, se usa el predeterminado y se avisa.
 */
export function MicPicker({ disabled, embedded }: Props) {
  const { t } = useI18n();
  const { prefs, update } = usePrefs();
  const mics = useMicrophones();
  const [testing, setTesting] = useState(false);
  const test = useMicTest(prefs.micId, testing && !disabled);
  const wrap = (rows: ReactNode) => (embedded ? rows : <div className="group-card">{rows}</div>);

  // Al empezar a grabar o desmontar, la prueba se apaga sola
  useEffect(() => {
    if (disabled) setTesting(false);
  }, [disabled]);

  if (!mics.supported) {
    return wrap(
      <p className="note">
        <Info size={16} aria-hidden />
        {t('mic.unsupported')}
      </p>,
    );
  }

  if (!mics.labelled) {
    return wrap(
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
      </div>,
    );
  }

  // «default» es un alias del dispositivo predeterminado: se presenta como la primera opción, con su nombre real
  const real = mics.devices.filter((device) => device.id !== 'default' && device.id !== '');
  const systemDefault = mics.devices.find((device) => device.id === 'default');
  const defaultName = cleanLabel((systemDefault?.label ?? '').replace(/^(default|predeterminado)\s*[-–:]\s*/i, ''));
  const selected = prefs.micId;
  const missing = selected !== '' && !real.some((device) => device.id === selected);

  const options: PickerOption<string>[] = [
    // El predeterminado va primero y separado de los dispositivos concretos; en el botón se ve su nombre real
    { value: '', label: t('mic.default'), hint: defaultName || undefined, short: defaultName || undefined, icon: Mic, separatorAfter: true },
    ...(missing ? [{ value: selected, label: t('mic.missing'), icon: Mic }] : []),
    ...real.map((device, index) => {
      const name = cleanLabel(device.label) || t('mic.unnamed', { n: index + 1 });
      return { value: device.id, label: name, icon: iconFor(name) };
    }),
  ];

  return wrap(
    <>
      <div className="list-row">
        <span className="row-icon tint-blue">
          <Mic size={18} />
        </span>
        <span className="row-text">
          <b>{t('mic.label')}</b>
          <small>{t('mic.count', { count: real.length })}</small>
        </span>
        <PickerMenu value={selected} options={options} onChange={(micId) => update({ micId })} label={t('mic.label')} menuTitle={t('mic.listTitle')} icon={Mic} disabled={disabled} />
      </div>

      {missing && (
        <p className="note note-warn">
          <Info size={16} aria-hidden />
          {t('mic.missingNote')}
        </p>
      )}

      <div className="mic-test">
        <button className={`btn btn-sm ${testing ? 'btn-tinted' : 'btn-gray'}`} onClick={() => setTesting((value) => !value)} disabled={disabled}>
          {testing ? <Square size={13} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
          {testing ? t('mic.testStop') : t('mic.test')}
        </button>
        <LevelMeter levelRef={test.levelRef} live={test.state === 'on'} label={t('mic.level')} />
        <span className="mic-test-state" aria-live="polite">
          {test.state === 'starting' ? t('mic.testStarting') : test.state === 'error' ? t('mic.testError') : test.state === 'on' ? t('mic.testing') : ''}
        </span>
      </div>
    </>,
  );
}
