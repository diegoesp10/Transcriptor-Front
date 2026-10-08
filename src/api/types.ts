/*
 * DTOs del backend MeetingTranscriber.Api (.NET 10). Contrato vivo: GET /openapi/v1.json (UI en /api-docs). Referencia:
 * Api/Contracts/Responses.cs. JSON en camelCase y enums como string.
 * `pnpm api:check` compara este archivo con el OpenAPI del backend en marcha.
 *
 *   MeetingStatusResponse  -> MeetingStatusDto   POST /api/meetings (202) · GET /api/meetings/{id}
 *   TranscriptResponse     -> TranscriptDto      GET /api/meetings/{id}/transcript
 *   RetryResponse          -> RetryDto           POST /api/meetings/{id}/retry (202)
 *   ErrorResponse          -> ErrorDto           409 de /transcript
 *   ProblemDetails         -> ProblemDetailsDto  400 (validación) y 500
 *   LocalExportResponse    -> LocalExportDto     GET /api/meetings/{id}/local-export
 *   MeetingSummaryResponse -> SummaryResponseDto POST /api/meetings/{id}/summary
 *   ConfirmLocalExportRequest -> ConfirmExportDto POST /api/meetings/{id}/local-export/confirm (204)
 *   TranscriptionConfigurationResponse -> TranscriptionConfigDto GET /api/transcription/configuration
 *
 * GET /api/errors no se usa a propósito: es un endpoint de diagnóstico para el operador, no para la interfaz.
 */

/** Domain.JobStatus */
export type JobStatus = 'Queued' | 'Processing' | 'Completed' | 'Failed';

export interface MeetingStatusDto {
  id: string;
  fileName: string;
  language: string;
  createdAt: string;
  status: JobStatus;
  completedChunks: number;
  totalChunks: number;
  /** Un FailureCode ("WhisperModelMissing", "NoAudio"…) o null cuando no hay error */
  errorCode: string | null;
  /** Caducidad de la copia temporal del servidor (24 h por defecto). null en reuniones anteriores a la migración. */
  temporaryExpiresAt: string | null;
  /** Reintentos explícitos ya consumidos (el servidor limita a MaxMeetingRetries, 3 por defecto) */
  retryCount: number;
  /** Explicación controlada del fallo, en español; nunca es el mensaje bruto del motor */
  errorMessage: string | null;
}

/** Domain.TranscriptSegment */
export interface TranscriptSegment {
  startSeconds: number;
  endSeconds: number;
  text: string;
  /**
   * speakerScope "meeting": "Hablante 1", "Hablante 2"… estables en toda la reunión.
   * speakerScope "chunk" (resultados antiguos): "chunk-{n}:{etiqueta}", local a cada fragmento de ~10 min.
   * null: atribución incierta.
   */
  speaker: string | null;
}

export interface RetryDto {
  id: string;
  status: JobStatus;
}

export interface ErrorDto {
  /** Código: "TranscriptNotCompleted", "MeetingRetryLimitExceeded", "WhisperModelMissing" (503)… */
  error: string;
}

/**
 * RFC 7807. `detail` trae un texto ya pensado para el usuario (validación y fallos controlados). Los rechazos y fallos
 * controlados añaden `code` ("ClientTemporarilyBlocked", "LocalInferenceBusy"…) y `correlationId`.
 */
export interface ProblemDetailsDto {
  type?: string | null;
  title?: string | null;
  status?: number | null;
  detail?: string | null;
  instance?: string | null;
  code?: string | null;
  correlationId?: string | null;
}

export interface TranscriptDto {
  id: string;
  language: string;
  /** "chunk": un solo tiempo por fragmento de ~10 min. "segment": tiempos reales por frase */
  timing: 'chunk' | 'segment';
  /** "meeting": hablantes globales de la diarización local · "chunk": resultados antiguos con etiquetas por fragmento */
  speakerScope: 'meeting' | 'chunk';
  segments: TranscriptSegment[];
}

/** GET /api/transcription/configuration: motores locales del servidor, sin rutas ni secretos */
export interface TranscriptionConfigDto {
  provider: string;
  model: string;
  modelAvailable: boolean;
  ffmpegAvailable: boolean;
  diarizationEnabled: boolean;
  diarizationAvailable: boolean;
  /** Se puede transcribir (comprueba archivos locales; una inferencia aún puede fallar) */
  ready: boolean;
  errorCode: string | null;
  summaryProvider: string;
  summaryModel: string;
  /** Ollama responde y tiene el modelo descargado */
  summaryReady: boolean;
  summaryErrorCode: string | null;
}

/** Tipos de archivo del manifiesto de exportación (LocalArtifact.kind) */
export type ArtifactKind = 'recording' | 'transcript-json' | 'transcript-text' | 'summary-json';

export interface LocalArtifactDto {
  kind: ArtifactKind;
  /** Nombre dentro de la carpeta de la reunión: recording.webm, transcript.json, transcript.txt, summary.json */
  fileName: string;
  contentType: string;
  /** Ruta relativa del servidor (GET, o POST para el resumen) */
  url: string | null;
  method: 'GET' | 'POST';
  available: boolean;
}

export interface LocalExportDto {
  meetingId: string;
  /** "meeting-{id sin guiones}": subcarpeta que se crea dentro de la carpeta elegida por el usuario */
  folderName: string;
  /** Siempre "browser-local-folder": el servidor nunca conoce la ruta ni el handle */
  destination: string;
  temporaryExpiresAt: string | null;
  /** true cuando la reunión terminó (Completed o Failed): ya se puede pedir el borrado de la copia del servidor */
  canConfirmExport: boolean;
  artifacts: LocalArtifactDto[];
}

export interface SummaryPointDto {
  text: string;
  /** Índices (base cero) del array `segments` de la transcripción que respaldan el punto */
  evidenceSegmentIndices: number[];
}

export interface MeetingSummaryDto {
  overview: string;
  highlights: SummaryPointDto[];
  decisions: SummaryPointDto[];
  actionItems: SummaryPointDto[];
  openQuestions: SummaryPointDto[];
}

export interface SummaryResponseDto {
  meetingId: string;
  generatedAt: string;
  /** Siempre un borrador: una referencia válida no certifica que el contenido sea verdad */
  requiresHumanReview: boolean;
  summary: MeetingSummaryDto;
}

export interface ConfirmExportDto {
  filesSaved: boolean;
}
