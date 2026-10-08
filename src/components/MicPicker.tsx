import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronsUpDown, Headphones, Info, Laptop, Mic, Play, Square, Usb, Webcam, type LucideIcon } from 'lucide-react';
import { useMicrophones, useMicTest } from '../hooks/useMicrophones';
import { usePopover } from '../hooks/usePopover';
import { usePrefs } from '../hooks/usePrefs';
import { useI18n } from '../i18n';
import { LevelMeter } from './LevelMeter';

interface Props {
  /** true mientras se graba: el micrófono no se puede cambiar ni probar */
  disabled?: boolean;
}

interface Choice {
  id: string;
  name: string;
  hint?: string;
  icon: LucideIcon;
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

  // «default» es un alias del dispositivo predeterminado: se presenta como la primera opción, con su nombre real
  const real = mics.devices.filter((device) => device.id !== 'default' && device.id !== '');
  const systemDefault = mics.devices.find((device) => device.id === 'default');
  const defaultName = cleanLabel((systemDefault?.label ?? '').replace(/^(default|predeterminado)\s*[-–:]\s*/i, ''));
  const selected = prefs.micId;
  const missing = selected !== '' && !real.some((device) => device.id === selected);

  const choices: Choice[] = [
    { id: '', name: t('mic.default'), hint: defaultName || undefined, icon: Mic },
    ...(missing ? [{ id: selected, name: t('mic.missing'), icon: Mic }] : []),
    ...real.map((device, index) => {
      const name = cleanLabel(device.label) || t('mic.unnamed', { n: index + 1 });
      return { id: device.id, name, icon: iconFor(name) };
    }),
  ];
  const current = choices.find((choice) => choice.id === selected) ?? choices[0];

  return (
    <div className="mic-picker">
      <div className="list-row">
        <span className="row-icon tint-blue">
          <Mic size={18} />
        </span>
        <span className="row-text">
          <b>{t('mic.label')}</b>
          <small>{t('mic.count', { count: real.length })}</small>
        </span>
        <MicSelect choices={choices} current={current} disabled={disabled} onSelect={(micId) => update({ micId })} />
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
    </div>
  );
}

/** Botón cápsula con el micrófono elegido que abre un menú emergente de vidrio, como los menús del sistema */
function MicSelect({ choices, current, disabled, onSelect }: { choices: Choice[]; current: Choice; disabled?: boolean; onSelect: (id: string) => void }) {
  const { t } = useI18n();
  const { open, setOpen, ref } = usePopover();
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);

  // Al abrir, el foco va a la opción elegida para poder moverse con las flechas (solo al abrir, no en cada render)
  const currentIndex = useRef(0);
  currentIndex.current = Math.max(0, choices.indexOf(current));
  useEffect(() => {
    if (open) options.current[currentIndex.current]?.focus();
  }, [open]);

  const choose = (id: string) => {
    onSelect(id);
    setOpen(false);
    trigger.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const index = options.current.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      event.preventDefault();
      options.current[(to + choices.length) % choices.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(index + 1);
    else if (event.key === 'ArrowUp') move(index - 1);
    else if (event.key === 'Home') move(0);
    else if (event.key === 'End') move(choices.length - 1);
    else if (event.key === 'Escape' || event.key === 'Tab') {
      setOpen(false);
      trigger.current?.focus();
    }
  };

  const CurrentIcon = current.icon;
  return (
    <div className="menu mic-select" ref={ref}>
      <button
        ref={trigger}
        className="picker-btn"
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('mic.label')}: ${current.hint ? `${current.name} (${current.hint})` : current.name}`}
      >
        <CurrentIcon size={15} aria-hidden />
        <span className="picker-value">{current.id === '' && current.hint ? current.hint : current.name}</span>
        <ChevronsUpDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="menu-panel popover glass mic-menu" role="listbox" aria-label={t('mic.label')} onKeyDown={onKeyDown}>
          <p className="menu-title">{t('mic.listTitle')}</p>
          {choices.map((choice, index) => {
            const Icon = choice.icon;
            const isCurrent = choice.id === current.id;
            return (
              <Fragment key={choice.id || 'default'}>
                <button
                  ref={(element) => {
                    options.current[index] = element;
                  }}
                  role="option"
                  aria-selected={isCurrent}
                  className={`menu-item ${isCurrent ? 'is-current' : ''}`}
                  onClick={() => choose(choice.id)}
                >
                  <Icon size={18} />
                  <span>
                    <b>{choice.name}</b>
                    {choice.hint && <small>{choice.hint}</small>}
                  </span>
                  <Check size={16} className="menu-check" aria-hidden />
                </button>
                {/* El predeterminado va primero y separado de los dispositivos concretos */}
                {index === 0 && choices.length > 1 && <hr />}
              </Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
}
