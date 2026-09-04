// Mirrors the Data Dictionary in CLAUDE.md. Kept in sync manually with the
// backend's Python types (see ADR 0001) — there is no shared/generated package.

export interface Course {
  id: string
  name: string
  year: number
  semester: string
  credits: number
}

export interface CourseMembership {
  userId: string
  courseId: string
  role: 'owner' | 'member'
  finalGrade?: number
}

export interface Topic {
  id: string
  courseId: string
  name: string
  isPriority: boolean
}

export type ActionType = 'read' | 'summarize' | 'quiz'

export interface LearningAction {
  id: string
  topicId: string
  type: ActionType
  defaultDurationMinutes: number
}

export type TopicStatus = 'backlog' | 'todo' | 'in_progress' | 'needs_review' | 'done'

export interface UserTopicProgress {
  userId: string
  topicId: string
  status: TopicStatus
  masteryLevel?: 1 | 2 | 3 | 4 | 5
}

export interface UserActionProgress {
  userId: string
  actionId: string
  isDone: boolean
}

export interface BlockedSlot {
  day: number
  startTime: string
  endTime: string
}

export interface UserConstraints {
  userId: string
  blockedSlots: BlockedSlot[]
  timePreference: 'morning' | 'evening'
}
