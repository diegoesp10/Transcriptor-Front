import type { MeetingProgressDto, ProcessingStage, ProcessingStep, SpeakerIdentityDto } from '../api/types';
import type { LibraryItem } from '../db/model';

/*
 * Fases de una transcripción tal como las muestra la interfaz. El backend informa de 12 fases (ProcessingStage); aquí se
 * agrupan en 6 pasos comprensibles, en el orden en que los recorre el worker. Si el backend no da progreso (versiones
 * antiguas), se deduce lo que se puede del estado: cola, preparación y fragmentos.
 *
 * El porcentaje es siempre el de la FASE actual (stagePercent): el backend no estima un avance total ni un tiempo
 * restante, y no se inventa aquí.
 */

export const STEPS = ['queued', 'preparing', 'diarizing', 'transcribing', 'naming', 'saving'] as const;
export type Step = (typeof STEPS)[number];

const STEP_OF: Record<ProcessingStage, Step | null> = {
  Queued: 'queued',
  // Foto reconstruida tras un reinicio del servidor: sin detalle, se deduce del estado
  Processing: null,
  ExtractingAudio: 'preparing',
  PreparingChunks: 'preparing',
  LoadingDiarizationModel: 'diarizing',
  DetectingSpeakers: 'diarizing',
  LoadingTranscriptionModel: 'transcribing',
  Transcribing: 'transcribing',
  IdentifyingSpeakers: 'naming',
  SavingResults: 'saving',
  Completed: 'saving',
  Failed: null,
};

export interface JobProgress {
  step: Step;
  /** Fase exacta del backend, si la ha dado (para el texto de detalle) */
  stage: ProcessingStage | null;
  substep: ProcessingStep | null;
  /** Avance de la fase actual, 0‑1; null si no se puede medir (indicador indeterminado) */
  fraction: number | null;
  completedChunks: number;
  totalChunks: number;
  /** Fragmento en curso, desde 1 */
  chunkNumber: number | null;
  processedAudioSeconds: number | null;
  audioDurationSeconds: number | null;
  elapsedSeconds: number | null;
  /** Voces detectadas hasta ahora; null si el backend no informa de ellas */
  speakers: SpeakerIdentityDto[] | null;
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

/** Paso, fase y avance de un trabajo del servidor (Queued o Processing) */
export function jobProgress(item: LibraryItem, live: MeetingProgressDto | null): JobProgress {
  const totalChunks = live?.totalChunks ?? item.totalChunks;
  const completedChunks = live?.completedChunks ?? item.completedChunks;
  const reported = live ? STEP_OF[live.stage] : null;

  let step: Step;
  if (reported) step = reported;
  else if ((live?.status ?? item.status) === 'Queued') step = 'queued';
  else step = totalChunks > 0 ? 'transcribing' : 'preparing';

  let fraction: number | null = null;
  if (reported && live?.stagePercent != null) fraction = clamp(live.stagePercent / 100);
  // Sin porcentaje del backend, en la transcripción al menos se sabe cuántos fragmentos van
  else if (!reported && step === 'transcribing' && totalChunks > 0) fraction = clamp(completedChunks / totalChunks);

  const chunkNumber = live?.currentChunk ?? (step === 'transcribing' && totalChunks > 0 && completedChunks < totalChunks ? completedChunks + 1 : null);
  return {
    step,
    stage: reported ? live!.stage : null,
    substep: live?.step ?? null,
    fraction,
    completedChunks,
    totalChunks,
    chunkNumber,
    processedAudioSeconds: live?.processedAudioSeconds ?? null,
    audioDurationSeconds: live?.audioDurationSeconds ?? null,
    elapsedSeconds: live?.elapsedSeconds ?? null,
    speakers: live ? live.speakers : null,
  };
}

/**
 * Tiempo que queda de transcripción a partir del ritmo medido en esta pestaña. Solo durante la fase de transcripción
 * (la única con un avance que refleja el tiempo real, según el audio procesado) y cuando ya se ha visto avanzar lo
 * suficiente para que no sea un número inventado.
 */
export class EtaEstimator {
  private start: { at: number; value: number } | null = null;

  estimate(fraction: number | null, now = Date.now()): number | null {
    if (fraction == null) {
      this.start = null;
      return null;
    }
    if (!this.start || fraction < this.start.value) this.start = { at: now, value: fraction };
    const gained = fraction - this.start.value;
    const elapsed = (now - this.start.at) / 1000;
    if (gained < 0.05 || elapsed < 20) return null;
    return ((1 - fraction) * elapsed) / gained;
  }
}
