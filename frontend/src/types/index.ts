// Mirrors the Data Dictionary in CLAUDE.md. Kept in sync manually with the
// backend's Python types (see ADR 0001) - there is no shared/generated package.

export interface User {
  id: string
  email: string
}

export interface Course {
  id: string
  name: string
  year: number
  semester: string
  credits: number
  examDate?: string | null
  examType: ExamType
  finalGrade?: number | null
  role: 'owner' | 'member'
}

export type ExamType = 'closed' | 'open_material' | 'formula_sheet'

export interface Topic {
  id: string
  courseId: string
  name: string
  isPriority: boolean
}

export type ActionType = 'read' | 'summarize' | 'quiz'

export type TopicStatus = 'backlog' | 'todo' | 'in_progress' | 'needs_review' | 'done'

export type MasteryLevel = 1 | 2 | 3 | 4 | 5

export interface BoardAction {
  id: string
  type: ActionType
  durationMinutes: number
  isDone: boolean
}

/** A topic card on the board: shared topic data joined with this user's progress. */
export interface BoardCard {
  topicId: string
  courseId: string
  courseName: string
  name: string
  isPriority: boolean
  masteryLevel: MasteryLevel | null
  status: TopicStatus
  needsMasteryRating: boolean
  actions: BoardAction[]
  actionsDone: number
  totalMinutes: number
}

export interface Board {
  columns: Record<TopicStatus, BoardCard[]>
  cards: BoardCard[]
  totalTopics: number
  doneTopics: number
}

export type BlockType = 'action' | 'review' | 'study_aid'

export interface ScheduleBlock {
  start: string
  end: string
  durationMinutes: number
  blockType: BlockType
  topicId: string | null
  topicName: string | null
  actionType: ActionType | null
  label: string
}

export interface Schedule {
  feasible: boolean
  isEmergencyMode: boolean
  blocks: ScheduleBlock[]
  totalAvailableMinutes: number
  totalNeededMinutes: number
  reason?: string | null
  shortfallMinutes?: number | null
}

export interface BlockedSlot {
  day: number
  startTime: string
  endTime: string
}

export interface UserConstraints {
  blockedSlots: BlockedSlot[]
  timePreference: 'morning' | 'evening'
}

export interface AverageBreakdown {
  label: string
  average: number | null
  totalCredits: number
  gradedCourseCount: number
}

export interface Grades {
  overall: AverageBreakdown
  perSemester: AverageBreakdown[]
  courses: Course[]
}

/** This week's sprint: what was committed against the hours actually free. */
export interface Sprint {
  startsAt: string
  endsAt: string
  daysRemaining: number
  capacityMinutes: number
  committedMinutes: number
  completedMinutes: number
  remainingCapacityMinutes: number
  topicCount: number
  backlogCount: number
  status: 'empty' | 'healthy' | 'tight' | 'over_committed' | 'no_capacity'
}

export interface AiSettings {
  aiEnabled: boolean
  hasApiKey: boolean
  keyHint: string | null
}

export interface Velocity {
  actionsCompletedThisWeek: number
  actionsCompletedLastWeek: number
  weeklyAverage: number
  averageMastery: number | null
  trend: 'up' | 'down' | 'steady'
}

export const STATUS_ORDER: TopicStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'needs_review',
  'done',
]

export const STATUS_LABELS: Record<TopicStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  needs_review: 'Needs review',
  done: 'Done',
}

export const ACTION_LABELS: Record<ActionType, string> = {
  read: 'Read',
  summarize: 'Summarize',
  quiz: 'Quiz',
}
