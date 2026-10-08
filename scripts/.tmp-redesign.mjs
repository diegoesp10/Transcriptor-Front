import { readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(p, 'utf8');
function edit(p, pairs) {
  let s = read(p);
  for (const [a, b] of pairs) {
    if (!s.includes(a)) throw new Error(`${p}: no encuentro «${a.slice(0, 80)}»`);
    s = s.split(a).join(b);
  }
  writeFileSync(p, s);
}
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

// 1) Renombrados mecánicos en todos los .tsx
for (const file of walk('src').filter((f) => f.endsWith('.tsx'))) {
  let s = read(file);
  const before = s;
  s = s.replaceAll('<Window', '<Panel').replaceAll('</Window>', '</Panel>');
  s = s.replaceAll("import { Window } from './Window';", "import { Panel } from './Panel';").replaceAll("import { Window } from '../components/Window';", "import { Panel } from '../components/Panel';");
  s = s.replace(/\sclassName="serif"/g, '').replace(/\sclassName="pixel"/g, '');
  if (s !== before) writeFileSync(file, s);
}

// 2) Reunión
edit('src/views/Meeting.tsx', [
  ["import { Composition } from '../components/Composition';\n", ''],
  ["import { PixelIcon } from '../components/PixelIcon';\n", "import { EmptyState } from '../components/EmptyState';\n"],
  [`        <div className="empty win">
          <PixelIcon name="sad" size={64} />
          <h2>{t('meeting.notFound')}</h2>
          <a className="btn btn-primary" href={hrefOf({ name: 'library' })}>
            {t('meeting.backToLibrary')}
          </a>
        </div>`,
   `        <Panel>
          <EmptyState icon={SearchX} tint="gray" title={t('meeting.notFound')}>
            <a className="btn btn-primary" href={hrefOf({ name: 'library' })}>
              {t('meeting.backToLibrary')}
            </a>
          </EmptyState>
        </Panel>`],
  ['<b className="lcd">', '<b className="ring-percent">'],
  ['<PixelIcon name="sad" size={96} className="state-icon" />', '<span className="state-icon tint-red"><XCircle size={44} strokeWidth={1.5} /></span>'],
  ['<Composition className="state-art" compact />', '<span className="state-icon tint-blue"><AudioLines size={44} strokeWidth={1.5} /></span>'],
]);
{
  let s = read('src/views/Meeting.tsx');
  s = s.replace(/import \{([^}]*)\} from 'lucide-react';/, (all, list) => `import {${list.trimEnd()}, AudioLines, SearchX, XCircle } from 'lucide-react';`);
  writeFileSync('src/views/Meeting.tsx', s);
}

// 3) Biblioteca
edit('src/views/Library.tsx', [
  ["import { Composition } from '../components/Composition';\n", "import { EmptyState } from '../components/EmptyState';\n"],
  [`        <div className="empty win">
          <Composition className="empty-art" />
          <h2>{t('library.empty.title')}</h2>
          <p>{t('library.empty.text')}</p>
          <a className="btn btn-primary" href={hrefOf({ name: 'studio' })}>
            <Mic size={16} />
            {t('library.empty.cta')}
          </a>
        </div>`,
   `        <Panel>
          <EmptyState icon={AudioLines} title={t('library.empty.title')} text={t('library.empty.text')}>
            <a className="btn btn-primary" href={hrefOf({ name: 'studio' })}>
              <Mic size={16} />
              {t('library.empty.cta')}
            </a>
          </EmptyState>
        </Panel>`],
]);
{
  let s = read('src/views/Library.tsx');
  s = s.replace(/import \{([^}]*)\} from 'lucide-react';/, (all, list) => `import {${list.trimEnd()}, AudioLines } from 'lucide-react';`);
  s = s.replace("import { ItemCard } from '../components/ItemCard';", "import { ItemCard } from '../components/ItemCard';\nimport { Panel } from '../components/Panel';");
  writeFileSync('src/views/Library.tsx', s);
}

// 4) Carpeta de destino
edit('src/components/FolderPanel.tsx', [
  ["import { Info } from 'lucide-react';", "import { FolderOpen, Info } from 'lucide-react';"],
  ["import { PixelIcon } from './PixelIcon';\n", ''],
  ['<PixelIcon name="folder" size={56} />', '<span className="folder-tile tint-blue lg"><FolderOpen size={30} strokeWidth={1.75} /></span>'],
  ['<PixelIcon name="folder" size={40} />', '<span className="folder-tile tint-blue"><FolderOpen size={22} strokeWidth={1.75} /></span>'],
  ['<small className="pixel">{t(\'local.current\')}</small>', "<small>{t('local.current')}</small>"],
]);

// 5) Onda del reproductor: un solo color de acento
edit('src/components/Waveform.tsx', [
  ["  // La parte reproducida lleva la franja de Apple repartida a lo largo de toda la onda\n  const played = shown?.map((peak, index) => <i key={index} style={{ height: heightOf(peak), '--c': `var(--rb-${Math.min(5, Math.floor((index / shown.length) * 6))})` } as CSSProperties} />);\n", ''],
  ['        {played}', '        {bars}'],
]);

// 6) Navegación y arranque
edit('src/App.tsx', [
  ["import { MenuBar } from './components/MenuBar';", "import { Navigation } from './components/Navigation';"],
  ['<MenuBar route={route} theme={theme} onTheme={setTheme} backend={backend.state} />', '<Navigation route={route} theme={theme} onTheme={setTheme} backend={backend.state} />'],
]);
{
  let s = read('src/main.tsx');
  s = s.replace(/\/\/ Tipografías propias[\s\S]*?import '@fontsource\/dm-mono\/latin-500\.css';\n/, `// Tipografía: en equipos Apple se usa la fuente del sistema (San Francisco), que ya está instalada y no se redistribuye.
// En el resto de plataformas, Inter (licencia SIL OFL 1.1, empaquetada con la app: ninguna petición a terceros, así no se cede la IP).
import '@fontsource-variable/inter/wght.css';
`);
  writeFileSync('src/main.tsx', s);
}

// 7) Ajustes: sección de micrófono
edit('src/views/Settings.tsx', [
  ["import { FolderPanel } from '../components/FolderPanel';", "import { FolderPanel } from '../components/FolderPanel';\nimport { MicPicker } from '../components/MicPicker';"],
  ["        <Section title={t('settings.transcription')}>", "        <Section title={t('settings.microphone')}>\n          <MicPicker />\n        </Section>\n\n        <Section title={t('settings.transcription')}>"],
]);

// 8) Fuera lo antiguo
for (const file of ['PixelIcon.tsx', 'Composition.tsx', 'MenuBar.tsx', 'VuMeter.tsx', 'Window.tsx']) rmSync(join('src/components', file), { force: true });
console.log('ok');
