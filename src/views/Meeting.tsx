import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowLeft, Check, Pencil, RefreshCw, Sparkles, Trash2, X, AudioLines, SearchX, XCircle } from 'lucide-react';
import { getTranscriptTxt } from '../api/client';
import type { SummaryResponseDto, TranscriptDto } from '../api/types';
import { Analysis } from '../components/Analysis';
import { LocalSavePanel } from '../components/LocalSavePanel';
import { SummaryPanel } from '../components/SummaryPanel';
import { ConfirmButton } from '../components/ConfirmButton';
import { ExportMenu } from '../components/ExportMenu';
import { LanguageSelect } from '../components/LanguageSelect';
import { Loader } from '../components/Loader';
import { MediaPlayer } from '../components/MediaPlayer';
import { EmptyState } from '../components/EmptyState';
import { EngineNotice } from '../components/EngineNotice';
import { LiveProgress } from '../components/LiveProgress';
import { ProcessingArt } from '../components/ProcessingArt';
import { Segmented } from '../components/Segmented';
import { StatusBadge } from '../components/StatusBadge';
import { Transcript } from '../components/Transcript';
import { Panel } from '../components/Panel';
import { useItemProgress } from '../hooks/useItemProgress';
import { useMediaPlayer } from '../hooks/useMediaPlayer';
import { useI18n } from '../i18n';
import { useItem, useLibrary } from '../state/library';
import { hrefOf, type Route } from '../state/route';
import { useToasts } from '../state/toasts';
import type { LibraryItem } from '../db/model';
import { apiErrorText, jobErrorText } from '../utils/errors';
import { buildExport, EXPORT_FORMATS, exportFileName, plainText, type ExportFormat, type MarkdownLabels } from '../utils/exporters';
import { formatDuration, formatLongDate } from '../utils/format';
import { downloadBlob } from '../utils/media';
import { analyze, normalizeTranscript, speakerName, speakersOf, spansChunks, type SpeakerNaming } from '../utils/transcript';

type Tab = 'transcript' | 'analysis';

export function Meeting({ id, navigate }: { id: string; navigate: (route: Route) => void }) {
  const { t, locale } = useI18n();
  const item = useItem(id);
  const library = useLibrary();
  const toast = useToasts();
  const [media, setMedia] = useState<Blob | undefined>();
  const [rawDto, setDto] = useState<TranscriptDto | undefined>();
  // Voces identificadas por speakerId y nombres detectados aparte (ver normalizeTranscript)
  const normalized = useMemo(() => (rawDto ? normalizeTranscript(rawDto) : undefined), [rawDto]);
  const dto = normalized?.dto;
  const detected = normalized?.detected;
  const [load, setLoad] = useState<'idle' | 'loading' | 'error'>('idle');
  const [attempt, setAttempt] = useState(0);
  const [tab, setTab] = useState<Tab>('transcript');
  const [focus, setFocus] = useState<{ index: number; nonce: number } | null>(null);
  const [summary, setSummary] = useState<SummaryResponseDto | undefined>();
  const player = useMediaPlayer(media, item?.durationSec ?? null);

  const hasMedia = item?.hasMedia ?? false;
  const status = item?.status;
  const getBlob = library.getBlob;
  const getTranscript = library.getTranscript;
  const getSummary = library.getSummary;

  useEffect(() => {
    let cancelled = false;
    if (!hasMedia) return setMedia(undefined);
    void getBlob(id).then((blob) => !cancelled && setMedia(blob));
    return () => {
      cancelled = true;
    };
  }, [id, hasMedia, getBlob]);

  useEffect(() => {
    let cancelled = false;
    if (status !== 'Completed') {
      setDto(undefined);
      setLoad('idle');
      return;
    }
    setLoad('loading');
    getTranscript(id)
      .then((result) => {
        if (cancelled) return;
        setDto(result);
        setLoad(result ? 'idle' : 'error');
      })
      .catch(() => !cancelled && setLoad('error'));
    return () => {
      cancelled = true;
    };
  }, [id, status, attempt, getTranscript]);

  useEffect(() => {
    let cancelled = false;
    void getSummary(id).then((stored) => !cancelled && setSummary(stored));
    return () => {
      cancelled = true;
    };
  }, [id, getSummary]);

  const speakers = useMemo(() => (dto ? speakersOf(dto.segments) : []), [dto]);
  const names = item?.speakerNames;
  const naming = useMemo<SpeakerNaming>(
    () => ({
      names: names ?? {},
      detected: detected ?? {},
      voice: (label) => t('speaker.voice', { label }),
      voiceInPart: (label, part) => t('speaker.voicePart', { label, part }),
      numbered: (n) => t('speaker.numbered', { n }),
      unknown: t('speaker.unknown'),
      multiChunk: spansChunks(speakers),
    }),
    [names, detected, speakers, t],
  );
  const nameOf = useCallback((raw: string | null) => speakerName(raw, naming), [naming]);
  const analysis = useMemo(
    () => (dto ? analyze(dto.segments, dto.timing, nameOf, (raw) => (raw ? Math.max(0, speakers.indexOf(raw)) : 0)) : null),
    [dto, nameOf, speakers],
  );

  if (!library.ready) {
    return (
      <div className="view state-center">
        <Loader size={30} />
      </div>
    );
  }
  if (!item) {
    return (
      <div className="view">
        <Panel>
          <EmptyState icon={SearchX} tint="gray" title={t('meeting.notFound')}>
            <a className="btn btn-primary" href={hrefOf({ name: 'library' })}>
              {t('meeting.backToLibrary')}
            </a>
          </EmptyState>
        </Panel>
      </div>
    );
  }

  const markdownLabels: MarkdownLabels = {
    meta: { date: t('md.date'), language: t('md.language'), duration: t('md.duration'), speakers: t('md.speakers'), words: t('md.words') },
    keywords: t('analysis.keywords'),
    actions: t('analysis.actions'),
    figures: t('analysis.figures'),
    verifyNote: t('analysis.disclaimerShort'),
    transcript: t('md.transcript'),
    speakerNote: naming.multiChunk ? t('transcript.speakerScope') : '',
  };

  const doExport = (format: ExportFormat) => {
    if (!dto || !analysis) return;
    const ext = EXPORT_FORMATS.find((candidate) => candidate.id === format)!.ext;
    downloadBlob(buildExport(format, item, dto, nameOf, analysis, markdownLabels, locale), exportFileName(item.name, ext));
  };
  const copy = async () => {
    if (!dto) return;
    try {
      await navigator.clipboard.writeText(plainText(dto, nameOf));
      toast.push('success', t('export.copied'));
    } catch {
      toast.push('error', t('export.copyFailed'));
    }
  };
  const serverTxt = async () => {
    if (!item.meetingId) return;
    try {
      downloadBlob(await getTranscriptTxt(item.meetingId), exportFileName(item.name, 'txt'));
    } catch (error) {
      toast.push('error', apiErrorText(error, t));
    }
  };

  const jump = (index: number) => {
    setTab('transcript');
    setFocus({ index, nonce: Date.now() });
  };
  const seek = (seconds: number) => player.seek(seconds, true);
  const canSeek = Boolean(media);

  return (
    <div className="view meeting">
      <a className="back" href={hrefOf({ name: 'library' })}>
        <ArrowLeft size={16} />
        {t('meeting.backToLibrary')}
      </a>

      <header className="meeting-head">
        <div className="meeting-title">
          <EditableTitle value={item.name} onSave={(name) => library.rename(item.id, name)} />
          <ul className="meta">
            <li>
              <StatusBadge status={item.status} />
            </li>
            <li>{formatLongDate(item.createdAt, locale)}</li>
            {item.durationSec != null && <li className="mono">{formatDuration(item.durationSec)}</li>}
            <li>{new Intl.DisplayNames([locale], { type: 'language' }).of(item.language) ?? item.language}</li>
          </ul>
        </div>
        <div className="meeting-actions">
          {item.status === 'Completed' && dto && (
            <ExportMenu onExport={doExport} onCopy={() => void copy()} onServerTxt={item.serverCopy === 'deleted' ? undefined : () => void serverTxt()} onMedia={media ? () => downloadBlob(media, item.fileName) : undefined} />
          )}
          <ConfirmButton
            className="btn btn-plain btn-danger-text"
            icon={<Trash2 size={16} />}
            label={t('card.delete')}
            confirmLabel={t('meeting.deleteConfirm')}
            onConfirm={async () => {
              await library.remove(item.id);
              navigate({ name: 'library' });
            }}
          />
        </div>
      </header>

      {item.status === 'Completed' ? (
        load === 'loading' || (load === 'idle' && !dto) ? (
          <div className="state-center">
            <Loader size={28} />
          </div>
        ) : load === 'error' || !dto || !analysis ? (
          <div className="banner banner-danger" role="alert">
            <AlertCircle size={18} aria-hidden />
            <span>{t('meeting.transcriptError')}</span>
            <button className="btn btn-sm" onClick={() => setAttempt((value) => value + 1)}>
              <RefreshCw size={14} />
              {t('card.retry')}
            </button>
          </div>
        ) : (
          <>
            <LocalSavePanel item={item} hasSummary={Boolean(summary)} />
            <Segmented<Tab>
              className="tabs"
              label={t('meeting.tabs')}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'transcript', label: t('meeting.tabTranscript') },
                { value: 'analysis', label: t('meeting.tabAnalysis') },
              ]}
            />
            {tab === 'transcript' ? (
              <Transcript
                dto={dto}
                naming={naming}
                speakers={speakers}
                canSeek={canSeek}
                time={player.time}
                playing={player.playing}
                onSeek={seek}
                onRename={(speaker, name) => library.setSpeakerName(item.id, speaker, name)}
                focus={focus}
                title={item.name}
              />
            ) : (
              <div className="analysis-stack">
                <SummaryPanel item={item} summary={summary} onSummary={setSummary} onJump={jump} />
                <Analysis analysis={analysis} onJump={jump} onSeek={seek} canSeek={canSeek} time={player.time} duration={player.duration} multiChunk={naming.multiChunk} />
              </div>
            )}
          </>
        )
      ) : (
        <StatePanel item={item} />
      )}

      {media && (
        <div className="dock">
          <MediaPlayer player={player} peaks={item.peaks} kind={item.kind} />
        </div>
      )}
    </div>
  );
}

function EditableTitle({ value, onSave }: { value: string; onSave: (name: string) => void }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  if (!editing) {
    return (
      <h1 className="title-edit">
        <span>{value}</span>
        <button
          className="icon-btn icon-btn-sm"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          aria-label={t('meeting.rename')}
          title={t('meeting.rename')}
        >
          <Pencil size={15} />
        </button>
      </h1>
    );
  }
  const commit = () => {
    onSave(draft);
    setEditing(false);
  };
  return (
    <form
      className="title-form"
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <input autoFocus value={draft} maxLength={150} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => event.key === 'Escape' && setEditing(false)} aria-label={t('meeting.rename')} />
      <button type="submit" className="icon-btn" aria-label={t('common.save')}>
        <Check size={18} />
      </button>
      <button type="button" className="icon-btn" onClick={() => setEditing(false)} aria-label={t('common.cancel')}>
        <X size={18} />
      </button>
    </form>
  );
}

/** Lo que se ve mientras la reunión no está transcrita: pendiente, subiendo, procesando o fallida */
function StatePanel({ item }: { item: LibraryItem }) {
  const { t } = useI18n();
  const library = useLibrary();
  const progress = useItemProgress(item);

  // En el servidor: progreso sincronizado (en directo si el backend lo ofrece)
  if (item.status === 'Queued' || item.status === 'Processing') return <LiveProgress item={item} />;

  if (progress) {
    const percent = progress.fraction == null ? null : Math.round(progress.fraction * 100);
    return (
      <Panel className="state-panel" title={item.status === 'uploading' ? t('status.uploading') : t('status.Processing')}>
        <ProcessingArt fraction={progress.fraction}>
          <b className="ring-percent">{percent == null ? '...' : `${percent}%`}</b>
        </ProcessingArt>
        <div className="state-text">
          <h2>{item.status === 'uploading' ? t('meeting.uploadingTitle') : t('meeting.processingTitle')}</h2>
          <p className="lede">{progress.label}</p>
          <p className="muted">{item.status === 'uploading' ? t('meeting.uploadingHint') : t('meeting.processingHint')}</p>
          {item.status === 'uploading' && (
            <button className="btn" onClick={() => library.cancelUpload(item.id)}>
              <X size={16} />
              {t('card.cancel')}
            </button>
          )}
        </div>
      </Panel>
    );
  }

  if (item.status === 'Failed' || item.status === 'uploadFailed') {
    const failed = item.status === 'Failed';
    return (
      <Panel className="state-panel is-danger" title={failed ? t('status.Failed') : t('status.uploadFailed')}>
        <span className="state-icon tint-red"><XCircle size={44} strokeWidth={1.5} /></span>
        <div className="state-text">
          <h2>{failed ? t('meeting.failedTitle') : t('meeting.uploadFailedTitle')}</h2>
          <p className="lede">{failed ? jobErrorText(item.errorCode, item.errorMessage, t) : t('meeting.uploadFailedText')}</p>
          {failed && <p className="muted">{t('meeting.failedHint')}</p>}
          {failed && item.retryCount > 0 && <p className="muted small">{t('meeting.retries', { count: item.retryCount })}</p>}
          <EngineNotice />
          <button className="btn btn-primary" onClick={() => void library.retry(item.id)}>
            <RefreshCw size={16} />
            {failed ? t('meeting.retryJob') : t('card.retry')}
          </button>
        </div>
      </Panel>
    );
  }

  // local
  return (
    <Panel className="state-panel" title={t('status.local')}>
      <span className="state-icon tint-blue"><AudioLines size={44} strokeWidth={1.5} /></span>
      <div className="state-text">
        <h2>{t('meeting.localTitle')}</h2>
        <p className="lede">{t('meeting.localText')}</p>
        <EngineNotice />
        <div className="state-actions">
          <LanguageSelect value={item.language} onChange={(language) => library.setLanguage(item.id, language)} label={t('review.language')} align="start" />
          <button className="btn btn-primary btn-lg" onClick={() => library.transcribe(item.id)} disabled={!item.hasMedia}>
            <Sparkles size={18} />
            {t('card.transcribe')}
          </button>
        </div>
      </div>
    </Panel>
  );
}
