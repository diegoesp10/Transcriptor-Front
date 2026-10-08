import { AudioLines, FolderOpen, Mic, Monitor, Moon, SlidersHorizontal, Sun, type LucideIcon } from 'lucide-react';
import { useI18n, LANGS, type MessageKey } from '../i18n';
import type { ThemeChoice } from '../hooks/useTheme';
import { Segmented } from './Segmented';
import type { BackendState } from '../hooks/useBackendStatus';
import { hrefOf, type Route } from '../state/route';
import { isBusy, useLibrary } from '../state/library';
import { useRecording } from '../state/recorder';

interface Props {
  route: Route;
  theme: ThemeChoice;
  onTheme: (theme: ThemeChoice, origin?: { x: number; y: number }) => void;
  backend: BackendState;
}

const NAV: { route: Route; icon: LucideIcon; label: MessageKey }[] = [
  { route: { name: 'studio' }, icon: Mic, label: 'nav.studio' },
  { route: { name: 'library' }, icon: FolderOpen, label: 'nav.library' },
  { route: { name: 'settings' }, icon: SlidersHorizontal, label: 'nav.settings' },
];

const THEMES: { value: ThemeChoice; icon: LucideIcon; label: MessageKey; short: MessageKey }[] = [
  { value: 'system', icon: Monitor, label: 'theme.systemHint', short: 'theme.auto' },
  { value: 'day', icon: Sun, label: 'theme.day', short: 'theme.day' },
  { value: 'night', icon: Moon, label: 'theme.night', short: 'theme.night' },
];


/**
 * Navegación principal. En pantallas anchas es una barra lateral flotante de vidrio; en móvil, una barra de pestañas
 * flotante en la parte inferior. Es el único sitio, junto a los menús y el reproductor, donde se usa el material de
 * vidrio: el contenido va siempre en superficies sólidas.
 */
export function Navigation({ route, theme, onTheme, backend }: Props) {
  const { t, lang, setLang } = useI18n();
  const { items } = useLibrary();
  const { phase } = useRecording();
  const busy = items.filter(isBusy).length;
  const recording = phase === 'recording' || phase === 'paused';

  return (
    <aside className="sidebar glass">
      <a className="brand" href={hrefOf({ name: 'studio' })} aria-label={t('app.name')}>
        <span className="brand-mark" aria-hidden>
          <AudioLines size={19} strokeWidth={2} />
        </span>
        <span className="brand-name">{t('app.name')}</span>
      </a>

      <nav className="nav" aria-label={t('nav.label')}>
        {NAV.map(({ route: target, icon: Icon, label }) => {
          const current = route.name === target.name || (target.name === 'library' && route.name === 'meeting');
          return (
            <a key={target.name} className={`nav-item ${current ? 'is-current' : ''}`} href={hrefOf(target)} aria-current={current ? 'page' : undefined}>
              <span className="nav-icon">
                <Icon size={21} strokeWidth={1.75} />
                {target.name === 'library' && busy > 0 && <b className="nav-badge" aria-label={t('nav.busy', { count: busy })}>{busy}</b>}
                {target.name === 'studio' && recording && <i className="nav-rec" aria-label={t('nav.recording')} />}
              </span>
              <span className="nav-label">{t(label)}</span>
            </a>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-row">
          <span className={`status-pill status-${backend}`} title={t(`backend.${backend}.long`)}>
            <i aria-hidden />
            <span>{t(`backend.${backend}.short`)}</span>
          </span>
          <button className="icon-btn lang-btn" onClick={() => setLang(LANGS[(LANGS.indexOf(lang) + 1) % LANGS.length])} aria-label={t('lang.switch')} title={t('lang.switch')}>
            {lang.toUpperCase()}
          </button>
        </div>

        {/* Apariencia: tres opciones a la vista, con la activa marcada (antes era un solo botón que rotaba entre ellas) */}
        <div className="appearance">
        <span className="appearance-label">{t('theme.label')}</span>
        <Segmented<ThemeChoice>
          className="theme-seg"
          label={t('theme.label')}
          value={theme}
          onChange={(value, origin) => onTheme(value, origin)}
          options={THEMES.map(({ value, icon: Icon, label, short }) => ({
            value,
            label: (
              <>
                <Icon size={15} strokeWidth={1.9} />
                <span className="theme-text">{t(short)}</span>
              </>
            ),
            title: t(label),
            ariaLabel: t(label),
          }))}
        />
        </div>
      </div>
    </aside>
  );
}
