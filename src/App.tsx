import { Navigation } from './components/Navigation';
import { RecordingBar } from './components/RecordingBar';
import { useBackendStatus } from './hooks/useBackendStatus';
import { useTheme } from './hooks/useTheme';
import { EngineProvider } from './state/engine';
import { useRoute } from './state/route';
import { Library } from './views/Library';
import { Meeting } from './views/Meeting';
import { Settings } from './views/Settings';
import { Studio } from './views/Studio';

export function App() {
  const { route, navigate } = useRoute();
  const { theme, setTheme } = useTheme();
  const backend = useBackendStatus();

  return (
    <EngineProvider online={backend.state === 'online'}>
      <div className="app">
        <Navigation route={route} theme={theme} onTheme={setTheme} backend={backend.state} />
        <main className="main" id="main">
          {route.name !== 'studio' && <RecordingBar />}
          {route.name === 'studio' && <Studio backend={backend.state} navigate={navigate} />}
          {route.name === 'library' && <Library navigate={navigate} />}
          {route.name === 'meeting' && <Meeting key={route.id} id={route.id} navigate={navigate} />}
          {route.name === 'settings' && <Settings theme={theme} onTheme={setTheme} backend={backend} />}
        </main>
      </div>
    </EngineProvider>
  );
}
