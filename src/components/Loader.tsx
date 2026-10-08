/** Indicador de espera: un arco que gira. Decorativo: quien lo usa debe anunciar la espera con su propio texto. */
export function Loader({ size = 18 }: { size?: number }) {
  return (
    <svg className="loader" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity=".2" strokeWidth="3" />
      <path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
