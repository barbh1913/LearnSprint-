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

export type Priority = 'low' | 'medium' | 'high'

export interface Topic {
  id: string
  courseId: string
  name: string
  description: string | null
  priority: Priority
  /** Derived: priority === 'high'. Kept for older readers. */
  isPriority: boolean
}

/** A file the student attached to a topic (FR2.9). Private to its uploader. */
export interface Material {
  id: string
  topicId: string
  fileName: string
  fileType: string
  sizeBytes: number
  uploadedAt: string
}

export type ActionType = 'read' | 'summarize' | 'quiz' | 'custom'

export type TopicStatus = 'backlog' | 'todo' | 'in_progress' | 'needs_review' | 'done'

export type MasteryLevel = 1 | 2 | 3 | 4 | 5

/** A subtask of a topic (FR2.3): the three defaults plus whatever the student added. */
export interface BoardAction {
  id: string
  type: ActionType
  title: string
  order: number
  durationMinutes: number
  isDone: boolean
}

/** A topic card on the board: shared topic data joined with this user's progress. */
export interface BoardCard {
  topicId: string
  courseId: string
  courseName: string
  name: string
  description: string | null
  priority: Priority
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
  /** Set for action blocks only, so the calendar can open the exact action. */
  actionId: string | null
  label: string
  /** Which course the session belongs to - what the all-courses calendar labels it with. */
  courseId: string | null
  courseName: string | null
}

export type EventKind = 'study' | 'review' | 'study_aid'

export interface ScheduleEventAction {
  actionId: string
  title: string
  minutes: number
}

/** A topic on the calendar: its consecutive scheduled subtasks as one entry (ADR 0012). */
export interface ScheduleEvent {
  topicId: string | null
  topicName: string | null
  kind: EventKind
  start: string
  end: string
  durationMinutes: number
  label: string
  actions: ScheduleEventAction[]
  courseId: string | null
  courseName: string | null
}

export interface Schedule {
  feasible: boolean
  isEmergencyMode: boolean
  /** Per learning action - what the scheduler placed. */
  blocks: ScheduleBlock[]
  /** Per topic - what the Calendar shows. */
  events: ScheduleEvent[]
  totalAvailableMinutes: number
  totalNeededMinutes: number
  reason?: string | null
  shortfallMinutes?: number | null
}

/** One course's slice of the combined plan (FR3.1). */
export interface CourseSchedule extends Schedule {
  courseId: string
  courseName: string
  examDate: string
}

/** Every course's plan, nearest exam first, with the sessions merged in time order. */
export interface StudentPlan {
  courses: CourseSchedule[]
  blocks: ScheduleBlock[]
  events: ScheduleEvent[]
  totalAvailableMinutes: number
  totalNeededMinutes: number
  sessions: number
}

/** Whether this student's Google account is linked for calendar sync (FR6.2). Never carries the credential. */
export interface GoogleCalendarStatus {
  /** False when the server has no Google client set up - the Calendar page then hides the controls. */
  configured: boolean
  connected: boolean
  connectedAt: string | null
  lastSyncedAt: string | null
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

export interface WeeklyCount {
  weekStart: string
  completed: number
}

export interface Velocity {
  actionsCompletedThisWeek: number
  actionsCompletedLastWeek: number
  weeklyAverage: number
  averageMastery: number | null
  trend: 'up' | 'down' | 'steady'
  /** Last six weeks, oldest first — drives the velocity chart. */
  history: WeeklyCount[]
  /** Topic counts at mastery 1..5. */
  masteryDistribution: number[]
}

/** A member of a shared course (FR5.3).
 *
 * Deliberately carries no grade, constraints or schedule - the backend never
 * sends them, and this type is the record of that.
 */
export interface CourseMember {
  userId: string
  email: string
  role: 'owner' | 'member'
  isMe: boolean
  topicsTotal: number
  topicsDone: number
  percentComplete: number
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
  custom: 'Subtask',
}

export const PRIORITY_ORDER: Priority[] = ['low', 'medium', 'high']

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}
