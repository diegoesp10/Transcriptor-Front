import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { I18nProvider } from './i18n';
import { FolderProvider } from './state/folder';
import { LibraryProvider } from './state/library';
import { RecorderProvider } from './state/recorder';
import { ToastProvider } from './state/toasts';
// Tipografía: en equipos Apple se usa la fuente del sistema (San Francisco), que ya está instalada y no se redistribuye.
// En el resto de plataformas, Inter (licencia SIL OFL 1.1, empaquetada con la app: ninguna petición a terceros, así no se cede la IP).
import '@fontsource-variable/inter/wght.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/views.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <ToastProvider>
        <FolderProvider>
          <LibraryProvider>
            <RecorderProvider>
              <App />
            </RecorderProvider>
          </LibraryProvider>
        </FolderProvider>
      </ToastProvider>
    </I18nProvider>
  </StrictMode>,
);
