// Sidebar shell wrapped around every authenticated page.

import { NavLink, Outlet } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { appRoutes, routeGroups } from '../routes/routeConfig'
import { useAuth } from '../auth/AuthContext'
import { Logo } from './Logo'
import { cn } from '../lib/utils'

export function AppLayout() {
  const { user, logout } = useAuth()

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <div className="px-5 py-5">
          <Logo className="h-7 w-auto" />
        </div>

        <nav className="flex-1 space-y-6 px-3 py-2">
          {routeGroups.map((group) => {
            const routes = appRoutes.filter((route) => route.group === group)
            if (routes.length === 0) return null

            return (
              <div key={group}>
                <p className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                {routes.map(({ path, label, icon: Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors',
                        isActive
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="size-4" aria-hidden />
                    {label}
                  </NavLink>
                ))}
              </div>
            )
          })}
        </nav>

        <div className="border-t border-border p-3">
          <p className="truncate px-2 pb-2 text-xs text-muted-foreground">{user?.email}</p>
          <button
            onClick={logout}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-x-auto px-6 py-8 md:px-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
