import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/customers', label: 'Manajemen Nasabah', icon: 'group' },
  { to: '/history', label: 'Riwayat Akses', icon: 'history' },
  { to: '/serial', label: 'Serial Monitor', icon: 'terminal' },
  { to: '/settings', label: 'Pengaturan Sistem', icon: 'settings' },
]

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <span className="material-symbols-outlined" style={{ color: 'white', fontSize: '18px' }}>lock_open</span>
        </div>
        <div>
          <p style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2 }}>Smart Safe</p>
          <p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>IoT Monitoring</p>
        </div>
      </div>

      <nav style={{ flex: 1, padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <span className="material-symbols-outlined" style={{ fontSize: '18px' }}>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '14px 12px', borderTop: '1px solid var(--divider)' }}>
        <div style={{
          padding: '12px 14px',
          background: 'var(--bg-status)',
          borderRadius: '10px',
          border: '1px solid var(--border-card)',
        }}>
          <p style={{ fontSize: '10px', fontWeight: 700, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '7px' }}>
            System Status
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="live-dot" />
            <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>All systems normal</span>
          </div>
        </div>
      </div>
    </aside>
  )
}
