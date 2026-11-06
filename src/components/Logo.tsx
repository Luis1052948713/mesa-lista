export function Logo({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <rect width="40" height="40" rx="11" fill="var(--olive)" />
      <circle cx="20" cy="21" r="9.5" fill="none" stroke="var(--on-olive)" strokeWidth="2.2" />
      <path d="M20 8.5c3 3.3 3.6 6 1.6 8.4-.8-1.6-2-2.2-3.4-2.5.5 1.7 0 3-1.3 4-1.2-3.4-.1-6.6 3.1-9.9z" fill="var(--saffron)" />
      <path d="M9 31h22" stroke="var(--on-olive)" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
