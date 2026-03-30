import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../auth/auth-context.js';

const navItems = [
  { path: '/', label: 'Projects', exact: true },
  { path: '/search', label: 'Search', exact: false },
];

export function Layout() {
  const { logout } = useAuth();

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="w-56 bg-gray-900 text-white flex flex-col shrink-0">
        <div className="p-4 text-lg font-bold border-b border-gray-700 text-white">
          Agent FS
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              className={({ isActive }) =>
                `block px-3 py-2 rounded text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="p-4 text-sm text-gray-400 hover:text-white border-t border-gray-700 text-left transition-colors"
        >
          Sign Out
        </button>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}
