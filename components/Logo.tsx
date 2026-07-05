const ACC = '52, 120, 246'
const ACC_C = 'var(--color-primary)'

export default function Logo() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <svg width={22} height={22} viewBox="0 0 24 24">
        <rect x="2" y="2" width="20" height="20" fill="color-mix(in srgb, var(--color-primary) 10%, transparent)" stroke={ACC_C} strokeWidth="1.3" />
        <polygon points="12,3 21,12 12,21 3,12" fill="color-mix(in srgb, var(--color-primary) 25%, transparent)" stroke={ACC_C} strokeWidth="1.3" />
        <circle cx="12" cy="12" r="2.2" fill={ACC_C} />
      </svg>
      <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text-primary)', letterSpacing: '-0.3px' }}>NeSyCat</span>
    </div>
  )
}
