export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="embed-canvas" style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      {children}
    </div>
  )
}
