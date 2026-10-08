import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface Props {
  icon: LucideIcon;
  title: string;
  text?: string;
  /** Color del icono: uno de los colores del sistema */
  tint?: 'blue' | 'green' | 'orange' | 'red' | 'gray';
  children?: ReactNode;
}

/** Estado vacío: un icono en un círculo tintado, un título, una frase y, si hace falta, la acción */
export function EmptyState({ icon: Icon, title, text, tint = 'blue', children }: Props) {
  return (
    <div className="empty-state">
      <span className={`empty-icon tint-${tint}`}>
        <Icon size={34} strokeWidth={1.6} />
      </span>
      <h2>{title}</h2>
      {text && <p>{text}</p>}
      {children}
    </div>
  );
}
