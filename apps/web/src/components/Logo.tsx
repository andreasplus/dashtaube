export function Logo({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path d="M14 38c6-14 18-22 32-22-3 4-4 8-3 12 4 1 6 4 7 8-8 0-12 6-22 6-6 0-11-1-14-4z" fill="#fff" />
      <circle cx="41" cy="25" r="2" fill="var(--accent)" />
    </svg>
  );
}
