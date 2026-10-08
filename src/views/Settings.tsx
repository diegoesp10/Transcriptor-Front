import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Monitor, Moon, RefreshCw, ShieldCheck, Sun, Trash2 } from 'lucide-react';
import { ConfirmButton } from '../components/ConfirmButton';
import { FolderPanel } from '../components/FolderPanel';
import { MicPicker } from '../components/MicPicker';
import { LanguageSelect } from '../components/LanguageSelect';
import { Loader } from '../components/Loader';
import { Panel } from '../components/Panel';
import { Segmented } from '../components/Segmented';
import { storageEstimate } from '../db/idb';
import type { BackendState } from '../hooks/useBackendStatus';
import { usePrefs } from '../hooks/usePrefs';
import type { ThemeChoice } from '../hooks/useTheme';
import { LANGS, useI18n, type Lang } from '../i18n';
import type { TranscriptionConfigDto } from '../api/types';
import { useEngine } from '../state/engine';
import { useLibrary } from '../state/library';
import { useToasts } from '../state/toasts';
import { APP_ENV, envLabel } from '../utils/environment';
import { codeText } from '../utils/errors';
import { formatBytes } from '../utils/format';

interface Props {
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice, origin?: { x: number; y: number }) => void;
  backend: { state: BackendState; checkedAt: number | null; check: () => Promise<boolean> };
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Panel className="setting" title={title}>
      {children}
    </Panel>
  );
}

export function Settings({ theme, onTheme, backend }: Props) {
  const { t, lang, setLang, locale } = useI18n();
  const { prefs, update } = usePrefs();
  const { items, clearEverything } = useLibrary();
  const toast = useToasts();
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);

  const refreshUsage = useCallback(() => void storageEstimate().then(setUsage), []);
  useEffect(refreshUsage, [refreshUsage, items.length]);

  const engine = useEngine();
  const check = async () => {
    setChecking(true);
    const ok = await Promise.all([backend.check(), new Promise((resolve) => setTimeout(resolve, 400))]).then(([alive]) => alive);
    if (ok) await engine.refresh();
    setChecking(false);
  };
  const engineRows = (config: TranscriptionConfigDto) => [
    { label: t('engine.transcription'), detail: config.model, ok: config.modelAvailable },
    { label: 'FFmpeg', detail: null, ok: config.ffmpegAvailable },
    {
      label: t('engine.speakers'),
      detail: config.diarizationEnabled ? null : t('engine.disabled'),
      ok: config.diarizationEnabled ? config.diarizationAvailable : null,
    },
    { label: t('engine.summary'), detail: config.summaryModel, ok: config.summaryReady },
  ];

  const fraction = usage ? Math.min(1, usage.usage / usage.quota) : 0;

  return (
    <div className="view settings">
      <header className="page-head">
        <h1>
          {t('settings.title1')} <em>{t('settings.title2')}</em>
        </h1>
      </header>

      <div className="settings-grid">
        <Section title={t('settings.appearance')}>
          <div className="row">
            <span>{t('settings.theme')}</span>
            <Segmented<ThemeChoice>
              label={t('settings.theme')}
              value={theme}
              onChange={(value, origin) => onTheme(value, origin)}
              options={[
                { value: 'system', label: <><Monitor size={15} />{t('theme.system')}</>, title: t('theme.systemHint') },
                { value: 'day', label: <><Sun size={15} />{t('theme.day')}</> },
                { value: 'night', label: <><Moon size={15} />{t('theme.night')}</> },
              ]}
            />
          </div>
          <div className="row">
            <span>{t('settings.interfaceLanguage')}</span>
            <Segmented<Lang> label={t('settings.interfaceLanguage')} value={lang} onChange={setLang} options={LANGS.map((code) => ({ value: code, label: code === 'es' ? 'Español' : 'English' }))} />
          </div>
        </Section>

        <FolderPanel variant="settings" />

        <Section title={t('settings.microphone')}>
          <MicPicker />
        </Section>

        <Section title={t('settings.transcription')}>
          <div className="row">
            <span>
              {t('settings.audioLanguage')}
              <small>{t('settings.audioLanguageHint')}</small>
            </span>
            <LanguageSelect value={prefs.language} onChange={(language) => update({ language })} label={t('settings.audioLanguage')} />
          </div>
          <label className="row switch-row">
            <span>
              {t('settings.autoTranscribe')}
              <small>{t('settings.autoTranscribeHint')}</small>
            </span>
            <span className="switch">
              <input type="checkbox" checked={prefs.autoTranscribe} onChange={(event) => update({ autoTranscribe: event.target.checked })} />
              <i aria-hidden />
            </span>
          </label>
          <label className="row switch-row">
            <span>
              {t('local.autoSave')}
              <small>{t('local.autoSaveHint')}</small>
            </span>
            <span className="switch">
              <input type="checkbox" checked={prefs.autoSaveLocal} onChange={(event) => update({ autoSaveLocal: event.target.checked })} />
              <i aria-hidden />
            </span>
          </label>
        </Section>

        <Section title={t('settings.connection')}>
          <div className="row">
            <span className={`status-pill status-${backend.state}`}>
              <i aria-hidden />
              <span>{t(`backend.${backend.state}.short`)}</span>
            </span>
            <button className="btn btn-sm" onClick={() => void check()} disabled={checking}>
              {checking ? <Loader size={15} /> : <RefreshCw size={15} />}
              {t('settings.checkNow')}
            </button>
          </div>
          <p className="muted">{t(`backend.${backend.state}.long`)}</p>
          {backend.checkedAt && <p className="muted small">{t('settings.lastCheck', { time: new Date(backend.checkedAt).toLocaleTimeString(locale) })}</p>}
          <p className="muted small">{t('settings.connectionHelp')}</p>
        </Section>

        <Section title={t('engine.title')}>
          {engine.config ? (
            <>
              <ul className="engine-list">
                {engineRows(engine.config).map((row) => (
                  <li key={row.label}>
                    <span className={`engine-dot ${row.ok == null ? 'is-off' : row.ok ? 'is-ok' : 'is-bad'}`} aria-hidden />
                    <span className="engine-name">{row.label}</span>
                    <span className="engine-detail mono">{row.detail}</span>
                    <span className="engine-state">{row.ok == null ? '' : row.ok ? t('engine.ready') : t('engine.missing')}</span>
                  </li>
                ))}
              </ul>
              {!engine.config.ready && <p className="muted">{codeText(engine.config.errorCode, t) ?? t('engine.notReady')}</p>}
              {!engine.config.summaryReady && <p className="muted">{codeText(engine.config.summaryErrorCode, t) ?? t('summary.errors.unavailable')}</p>}
            </>
          ) : engine.config === null ? (
            <p className="muted">{t('engine.unknown')}</p>
          ) : (
            <Loader />
          )}
          <p className="muted small">{t('engine.help')}</p>
        </Section>

        <Section title={t('settings.storage')}>
          {usage ? (
            <>
              <div className="meter" role="img" aria-label={t('settings.storageUsed', { used: formatBytes(usage.usage, locale), quota: formatBytes(usage.quota, locale) })}>
                <i style={{ width: `${Math.max(1.5, fraction * 100)}%` }} />
              </div>
              <p className="muted">{t('settings.storageUsed', { used: formatBytes(usage.usage, locale), quota: formatBytes(usage.quota, locale) })}</p>
            </>
          ) : usage === undefined ? (
            <Loader />
          ) : null}
          <p className="muted">{t('settings.storageItems', { count: items.length })}</p>
          <div className="note note-privacy">
            <ShieldCheck size={18} aria-hidden />
            <p>{t('settings.privacy')}</p>
          </div>
          <ConfirmButton
            className="btn btn-danger-text"
            icon={<Trash2 size={16} />}
            label={t('settings.clear')}
            confirmLabel={t('settings.clearConfirm')}
            onConfirm={async () => {
              await clearEverything();
              refreshUsage();
              toast.push('info', t('settings.cleared'));
            }}
          />
        </Section>
      </div>

      <p className="version mono">
        {t('app.name')} · v{__APP_VERSION__} · {envLabel(APP_ENV, t)}
      </p>
    </div>
  );
}
