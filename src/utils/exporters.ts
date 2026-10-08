import type { SummaryResponseDto, TranscriptDto, TranscriptSegment } from '../api/types';
import type { Translate } from '../i18n';
import type { LibraryItem } from '../db/model';
import type { Analysis } from './transcript';
import { formatClock, formatCue, formatDuration } from './format';

/*
 * Exportaciones generadas en el navegador a partir de la transcripción original.
 * Usan los nombres de hablante que haya puesto el usuario; la transcripción guardada en el servidor no se toca.
 */

export type ExportFormat = 'txt' | 'srt' | 'vtt' | 'md' | 'json';

export const EXPORT_FORMATS: { id: ExportFormat; ext: string; mime: string }[] = [
  { id: 'txt', ext: 'txt', mime: 'text/plain' },
  { id: 'md', ext: 'md', mime: 'text/markdown' },
  { id: 'srt', ext: 'srt', mime: 'application/x-subrip' },
  { id: 'vtt', ext: 'vtt', mime: 'text/vtt' },
  { id: 'json', ext: 'json', mime: 'application/json' },
];

type NameOf = (raw: string | null) => string;

export interface MarkdownLabels {
  meta: { date: string; language: string; duration: string; speakers: string; words: string };
  keywords: string;
  actions: string;
  figures: string;
  verifyNote: string;
  transcript: string;
  /** Aviso sobre etiquetas de voz por fragmento; vacío si no aplica */
  speakerNote: string;
}

const txt = (segments: TranscriptSegment[], nameOf: NameOf) =>
  segments.map((s) => `[${formatClock(s.startSeconds)}] ${nameOf(s.speaker)}: ${s.text.trim()}`).join('\n');

const cues = (segments: TranscriptSegment[], nameOf: NameOf, separator: ',' | '.') =>
  segments
    .map((s, i) => {
      const end = Math.max(s.endSeconds, s.startSeconds + 0.5);
      const head = separator === ',' ? `${i + 1}\n` : '';
      return `${head}${formatCue(s.startSeconds, separator)} --> ${formatCue(end, separator)}\n${nameOf(s.speaker)}: ${s.text.trim()}`;
    })
    .join('\n\n');

function markdown(item: LibraryItem, dto: TranscriptDto, nameOf: NameOf, analysis: Analysis, labels: MarkdownLabels, locale: string): string {
  const lines: string[] = [`# ${item.name}`, ''];
  lines.push(`- **${labels.meta.date}:** ${new Date(item.createdAt).toLocaleString(locale)}`);
  lines.push(`- **${labels.meta.language}:** ${dto.language}`);
  lines.push(`- **${labels.meta.duration}:** ${formatDuration(analysis.durationSec)}`);
  lines.push(`- **${labels.meta.speakers}:** ${analysis.speakers.map((s) => s.name).join(', ') || '—'}`);
  lines.push(`- **${labels.meta.words}:** ${analysis.words}`, '');

  if (analysis.keywords.length) lines.push(`## ${labels.keywords}`, '', analysis.keywords.map((k) => k.word).join(' · '), '');
  if (analysis.actions.length) {
    lines.push(`## ${labels.actions}`, '', `> ${labels.verifyNote}`, '');
    for (const f of analysis.actions) lines.push(`- \`${formatClock(f.start)}\` ${f.sentence}`);
    lines.push('');
  }
  if (analysis.figures.length) {
    lines.push(`## ${labels.figures}`, '', `> ${labels.verifyNote}`, '');
    for (const f of analysis.figures) lines.push(`- \`${formatClock(f.start)}\` **${f.match}** — ${f.sentence}`);
    lines.push('');
  }

  lines.push(`## ${labels.transcript}`, '');
  if (labels.speakerNote) lines.push(`> ${labels.speakerNote}`, '');
  let previous: string | null | undefined;
  for (const s of dto.segments) {
    const name = nameOf(s.speaker);
    if (name !== previous) lines.push(`**${name}** · \`${formatClock(s.startSeconds)}\``, '');
    lines.push(s.text.trim(), '');
    previous = name;
  }
  return lines.join('\n');
}

export function buildExport(
  format: ExportFormat,
  item: LibraryItem,
  dto: TranscriptDto,
  nameOf: NameOf,
  analysis: Analysis,
  labels: MarkdownLabels,
  locale: string,
): Blob {
  const mime = EXPORT_FORMATS.find((f) => f.id === format)!.mime;
  let body: string;
  switch (format) {
    case 'txt':
      body = txt(dto.segments, nameOf);
      break;
    case 'srt':
      body = cues(dto.segments, nameOf, ',');
      break;
    case 'vtt':
      body = `WEBVTT\n\n${cues(dto.segments, nameOf, '.')}`;
      break;
    case 'md':
      body = markdown(item, dto, nameOf, analysis, labels, locale);
      break;
    case 'json':
      body = JSON.stringify(
        {
          title: item.name,
          meetingId: item.meetingId,
          createdAt: item.createdAt,
          language: dto.language,
          timing: dto.timing,
          segments: dto.segments.map((s) => ({ ...s, speakerName: nameOf(s.speaker) })),
        },
        null,
        2,
      );
      break;
  }
  return new Blob([format === 'txt' || format === 'md' ? `﻿${body}` : body], { type: `${mime};charset=utf-8` });
}

export const plainText = (dto: TranscriptDto, nameOf: NameOf) => txt(dto.segments, nameOf);

/** Nombre de archivo seguro a partir del título */
export function exportFileName(title: string, ext: string): string {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'transcripcion';
  return `${clean}.${ext}`;
}

/** summary.txt: el mismo contenido que summary.json, legible, con el aviso de borrador y las referencias a segmentos */
export function summaryToText(response: SummaryResponseDto, t: Translate): string {
  const { summary } = response;
  const sections: [string, typeof summary.highlights][] = [
    [t('summary.highlights'), summary.highlights],
    [t('summary.decisions'), summary.decisions],
    [t('summary.actionItems'), summary.actionItems],
    [t('summary.openQuestions'), summary.openQuestions],
  ];
  return [
    t('summary.draftNotice'),
    summary.overview,
    ...sections.flatMap(([title, points]) => [title, ...(points.length ? points.map((point) => `- ${point.text} [${t('summary.segments')}: ${point.evidenceSegmentIndices.join(', ')}]`) : [`- ${t('summary.none')}`])]),
  ].join('\n\n');
}
