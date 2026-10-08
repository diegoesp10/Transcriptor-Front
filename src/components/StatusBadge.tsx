import { AlertTriangle, CheckCircle2, Clock3, HardDrive, Loader2, UploadCloud, XCircle, type LucideIcon } from 'lucide-react';
import type { ItemStatus } from '../db/model';
import { useI18n, type MessageKey } from '../i18n';

const BADGES: Record<ItemStatus, { tone: string; label: MessageKey; icon: LucideIcon }> = {
  local: { tone: 'gray', label: 'status.local', icon: HardDrive },
  uploading: { tone: 'blue', label: 'status.uploading', icon: UploadCloud },
  uploadFailed: { tone: 'red', label: 'status.uploadFailed', icon: AlertTriangle },
  Queued: { tone: 'blue', label: 'status.Queued', icon: Clock3 },
  Processing: { tone: 'orange', label: 'status.Processing', icon: Loader2 },
  Completed: { tone: 'green', label: 'status.Completed', icon: CheckCircle2 },
  Failed: { tone: 'red', label: 'status.Failed', icon: XCircle },
};

/** Etiqueta de estado: cápsula tintada con icono, en el color del sistema que corresponde (verde = lista, rojo = fallo…) */
export function StatusBadge({ status }: { status: ItemStatus }) {
  const { t } = useI18n();
  const badge = BADGES[status];
  const Icon = badge.icon;
  return (
    <span className={`badge tint-${badge.tone}`}>
      <Icon size={13} strokeWidth={2.25} className={status === 'Processing' ? 'spin' : undefined} aria-hidden />
      {t(badge.label)}
    </span>
  );
}
