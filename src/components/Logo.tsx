interface LogoProps {
  size?: number;
}

// Marque Projekt : trois nœuds reliés en triangle, clin d'œil à la vue Graph.
export default function Logo({ size = 20 }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <line x1="12" y1="5" x2="6" y2="18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="12" y1="5" x2="18" y2="18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="6" y1="18" x2="18" y2="18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="5" r="2.4" fill="currentColor" />
      <circle cx="6" cy="18" r="2.4" fill="currentColor" />
      <circle cx="18" cy="18" r="2.4" fill="currentColor" />
    </svg>
  );
}
