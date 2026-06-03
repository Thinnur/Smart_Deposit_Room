import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/customers', label: 'Nasabah', icon: 'group' },
  { to: '/history', label: 'Riwayat', icon: 'history' },
  { to: '/settings', label: 'Pengaturan', icon: 'settings' },
]

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {navItems.map(({ to, label, icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            isActive ? 'bottom-nav__item bottom-nav__item--active' : 'bottom-nav__item'
          }
        >
          <span className="material-symbols-outlined bottom-nav__icon">{icon}</span>
          <span className="bottom-nav__label">{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}
