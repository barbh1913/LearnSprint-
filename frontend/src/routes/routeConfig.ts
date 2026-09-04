import type { LucideIcon } from 'lucide-react'
import { LayoutDashboard, BookOpen, Kanban, GanttChartSquare, Percent, UserCog } from 'lucide-react'

export interface AppRoute {
  path: string
  label: string
  icon: LucideIcon
  group: 'Home' | 'Planning' | 'Academic' | 'User'
}

export const appRoutes: AppRoute[] = [
  { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, group: 'Home' },
  { path: '/courses', label: 'Courses', icon: BookOpen, group: 'Planning' },
  { path: '/board', label: 'Board', icon: Kanban, group: 'Planning' },
  { path: '/gantt', label: 'Gantt', icon: GanttChartSquare, group: 'Planning' },
  { path: '/grades', label: 'Grades', icon: Percent, group: 'Academic' },
  { path: '/profile', label: 'Profile', icon: UserCog, group: 'User' },
]

export const routeGroups: AppRoute['group'][] = ['Home', 'Planning', 'Academic', 'User']
