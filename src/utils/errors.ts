import { ApiError, PAUSED_CODE } from '../api/client';
import type { MessageKey, Translate } from '../i18n';
import { LocalSaveError } from '../local/folder';

/** Texto traducido para un código del backend (FailureCode, ErrorResponse.error o ProblemDetails.code); null si no se conoce */
export function codeText(code: string | null | undefined, t: Translate): string | null {
  if (!code) return null;
  const key = `errors.codes.${code}` as MessageKey;
  const text = t(key);
  return text === key ? null : text;
}

/** "Espera 2 min" / "Espera 40 s" a partir de los segundos de Retry-After */
function waitText(seconds: number | null, t: Translate): string {
  const s = Math.max(1, seconds ?? 60);
  return s >= 90 ? t('errors.waitMinutes', { count: Math.ceil(s / 60) }) : t('errors.waitSeconds', { count: s });
}

/** Mensaje legible para un fallo de la API. El `detail` del backend (400) ya viene redactado para el usuario. */
export function apiErrorText(error: unknown, t: Translate): string {
  if (!(error instanceof ApiError)) return t('errors.unknown');
  const known = codeText(error.code, t);
  switch (error.status) {
    case 0:
      return t('errors.offline');
    case 400:
      return error.detail ?? known ?? t('errors.badRequest');
    case 401:
      return t('errors.auth');
    case 403:
      return error.code === 'ClientTemporarilyBlocked' || error.retryAfter != null ? `${t('errors.blocked')} ${waitText(error.retryAfter, t)}` : t('errors.forbidden');
    case 404:
      return known ?? t('errors.notFound');
    case 409:
      return known ?? t('errors.conflict');
    case 413:
      return known ?? t('errors.tooLarge');
    case 415:
      return known ?? t('errors.unsupported');
    case 429:
      return `${t(error.code === PAUSED_CODE ? 'errors.paused' : 'errors.rateLimited')} ${waitText(error.retryAfter, t)}`;
    case 503:
      // Falta un motor local (WhisperModelMissing, FFmpegUnavailable…) o el servidor no admite más peticiones ahora
      return known ?? error.detail ?? t('errors.unavailable');
    default:
      return error.status >= 500 ? (known ?? error.detail ?? t('errors.server')) : t('errors.unknown');
  }
}

/** Fallo del trabajo en el servidor: texto traducido del código; si no se conoce, la explicación controlada del servidor */
export function jobErrorText(code: string | null, message: string | null, t: Translate): string {
  const known = codeText(code, t);
  if (known) return known;
  if (message) return message;
  return code ? t('errors.job.other', { code }) : t('errors.job.unknown');
}

/** Fallo al guardar en la carpeta local (permiso, disco, descarga o verificación) */
export function localSaveErrorText(error: unknown, t: Translate): string {
  if (!(error instanceof LocalSaveError)) return error instanceof ApiError ? apiErrorText(error, t) : t('errors.unknown');
  switch (error.code) {
    case 'unsupported':
      return t('local.errors.unsupported');
    case 'permission':
      return t('local.errors.permission');
    case 'inactive':
      return t('local.errors.inactive');
    case 'disk':
      return t('local.errors.disk');
    case 'verify':
      return t('local.errors.verify');
    case 'artifact':
      return error.status === 404 ? t('local.errors.expired') : t('local.errors.artifact', { status: error.status ?? 0 });
    default:
      return t('local.errors.write');
  }
}

/** Fallo al generar el resumen con el modelo local */
export function summaryErrorText(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    const known = codeText(error.code, t);
    switch (error.status) {
      case 409:
        return t('summary.errors.notReady');
      case 413:
        return t('summary.errors.tooLong');
      case 502:
        return known ?? t('summary.errors.invalid');
      case 503:
        return known ?? t('summary.errors.unavailable');
      case 504:
        return t('summary.errors.timeout');
      case 404:
        return t('local.errors.expired');
    }
  }
  return apiErrorText(error, t);
}
