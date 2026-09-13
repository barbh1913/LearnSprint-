// Typed wrapper around the backend API. Every call goes through `request`, so
// the auth header and error handling live in exactly one place.

import type {
  AiSettings,
  Board,
  Course,
  CourseMember,
  ExamType,
  GoogleCalendarStatus,
  Grades,
  MasteryLevel,
  Material,
  Priority,
  Schedule,
  Sprint,
  StudentPlan,
  Topic,
  TopicStatus,
  User,
  UserConstraints,
  Velocity,
} from '../types'

/** Result of analysing a batch of uploaded course files. */
export interface ExtractionResult {
  created: Topic[]
  detectedLanguage: string
  sourceFilenames: string[]
  analysedBy: 'ai' | 'heuristic'
  totalEstimatedMinutes: number
  note: string | null
}

/** What a topic edit may change. `description: null` clears it; a topic-level estimate is re-split across the subtasks. */
export interface TopicChanges {
  name?: string
  description?: string | null
  priority?: Priority
  estimatedMinutes?: number
}

export interface ActionResult {
  id: string
  topicId: string
  type: string
  title: string
  order: number
  durationMinutes: number
}

export interface GoogleSyncResult {
  synced: number
  lastSyncedAt: string
  /** One entry per course the sync covered; `skipped` carries the reason a course was left out. */
  courses: { courseId: string; courseName: string; synced: number; skipped: string | null }[]
}

const TOKEN_KEY = 'learnsprint.token'

// In development this stays empty and requests go to /api, which the Vite dev
// server proxies to localhost:8000. A deployed build has no proxy, so the API
// lives on another origin and VITE_API_BASE_URL supplies it at build time -
// in that case the routes are mounted at the API's own root (no /api prefix),
// so apiUrl() must not add one, or every request 404s against a path that
// doesn't exist (e.g. .../prod/api/auth/register instead of .../prod/auth/register).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? ''

function apiUrl(path: string): string {
  return API_BASE ? `${API_BASE}${path}` : `/api${path}`
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken()
  const isFormData = options.body instanceof FormData

  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status)
  }

  return response.status === 204 ? (undefined as T) : response.json()
}

async function downloadIcs(path: string, filename: string): Promise<void> {
  const response = await fetch(apiUrl(path), {
    headers: { Authorization: `Bearer ${getToken()}` },
  })
  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status)
  }

  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    // FastAPI validation errors come back as a list of objects, not a string.
    if (Array.isArray(body.detail)) {
      return body.detail.map((item: { msg?: string }) => item.msg).join(', ')
    }
    return body.detail ?? `Request failed (${response.status})`
  } catch {
    return `Request failed (${response.status})`
  }
}

export const api = {
  health: () => request<{ status: string }>('/health'),

  register: (email: string, password: string) =>
    request<{ access_token: string }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  login: (email: string, password: string) =>
    request<{ access_token: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<User>('/auth/me'),

  listCourses: () => request<Course[]>('/courses'),

  getCourse: (courseId: string) => request<Course>(`/courses/${courseId}`),

  createCourse: (course: {
    name: string
    year: number
    semester: string
    credits: number
    examDate?: string | null
    examType?: ExamType
  }) => request<Course>('/courses', { method: 'POST', body: JSON.stringify(course) }),

  updateCourse: (courseId: string, changes: Partial<Course>) =>
    request<Course>(`/courses/${courseId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  deleteCourse: (courseId: string) =>
    request<void>(`/courses/${courseId}`, { method: 'DELETE' }),

  setGrade: (courseId: string, finalGrade: number | null) =>
    request<Course>(`/courses/${courseId}/grade`, {
      method: 'PUT',
      body: JSON.stringify({ finalGrade }),
    }),

  getGrades: () => request<Grades>('/grades'),

  getConstraints: () => request<UserConstraints>('/constraints'),

  saveConstraints: (constraints: UserConstraints) =>
    request<UserConstraints>('/constraints', {
      method: 'PUT',
      body: JSON.stringify(constraints),
    }),

  listTopics: (courseId: string) => request<Topic[]>(`/courses/${courseId}/topics`),

  createTopic: (courseId: string, name: string) =>
    request<Topic>(`/courses/${courseId}/topics`, {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),

  updateTopic: (courseId: string, topicId: string, changes: TopicChanges) =>
    request<Topic>(`/courses/${courseId}/topics/${topicId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  deleteTopic: (courseId: string, topicId: string) =>
    request<void>(`/courses/${courseId}/topics/${topicId}`, { method: 'DELETE' }),

  // Subtasks (FR2.3)
  createAction: (courseId: string, topicId: string, title: string, durationMinutes: number) =>
    request<ActionResult>(`/courses/${courseId}/topics/${topicId}/actions`, {
      method: 'POST',
      body: JSON.stringify({ title, durationMinutes }),
    }),

  updateAction: (
    courseId: string,
    topicId: string,
    actionId: string,
    changes: { title?: string; durationMinutes?: number },
  ) =>
    request<ActionResult>(`/courses/${courseId}/topics/${topicId}/actions/${actionId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  deleteAction: (courseId: string, topicId: string, actionId: string) =>
    request<void>(`/courses/${courseId}/topics/${topicId}/actions/${actionId}`, {
      method: 'DELETE',
    }),

  // Materials attached to a topic (FR2.9) - the student's own only.
  listMaterials: (courseId: string, topicId: string) =>
    request<Material[]>(`/courses/${courseId}/topics/${topicId}/materials`),

  uploadMaterials: (courseId: string, topicId: string, files: File[]) => {
    const body = new FormData()
    for (const file of files) {
      body.append('files', file)
    }
    return request<Material[]>(`/courses/${courseId}/topics/${topicId}/materials`, {
      method: 'POST',
      body,
    })
  },

  getMaterialDownloadLink: (courseId: string, topicId: string, materialId: string) =>
    request<{ url: string; expiresInSeconds: number }>(
      `/courses/${courseId}/topics/${topicId}/materials/${materialId}/download`,
    ),

  deleteMaterial: (courseId: string, topicId: string, materialId: string) =>
    request<void>(`/courses/${courseId}/topics/${topicId}/materials/${materialId}`, {
      method: 'DELETE',
    }),

  /** Upload up to 15 files at once; they're analysed together as one corpus. */
  extractTopics: (courseId: string, files: File[]) => {
    const body = new FormData()
    for (const file of files) {
      body.append('files', file)
    }
    return request<ExtractionResult>(`/courses/${courseId}/topics/extract`, {
      method: 'POST',
      body,
    })
  },

  getSprint: () => request<Sprint>('/sprint'),

  getAiSettings: () => request<AiSettings>('/ai-settings'),

  saveAiSettings: (settings: { aiEnabled: boolean; apiKey?: string }) =>
    request<AiSettings>('/ai-settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),

  getBoard: (courseId?: string) =>
    request<Board>(courseId ? `/board?courseId=${courseId}` : '/board'),

  setTopicProgress: (
    courseId: string,
    topicId: string,
    changes: { status?: TopicStatus; masteryLevel?: MasteryLevel },
  ) =>
    request<{ topicId: string; status: TopicStatus; masteryLevel: MasteryLevel | null }>(
      `/topics/${topicId}/progress?courseId=${courseId}`,
      { method: 'PATCH', body: JSON.stringify(changes) },
    ),

  setActionDone: (courseId: string, actionId: string, isDone: boolean) =>
    request<{ actionId: string; isDone: boolean; topicId: string }>(
      `/actions/${actionId}/progress?courseId=${courseId}`,
      { method: 'PATCH', body: JSON.stringify({ isDone }) },
    ),

  getSchedule: (courseId: string) => request<Schedule>(`/courses/${courseId}/schedule`),

  // Google Calendar sync (FR6.2). The backend builds the consent URL so the
  // Google client id and secret never reach the browser.
  getGoogleCalendarStatus: () =>
    request<GoogleCalendarStatus>('/integrations/google-calendar/status'),
  getGoogleCalendarAuthorizeUrl: () =>
    request<{ authorizeUrl: string; state: string }>('/integrations/google-calendar/authorize'),
  connectGoogleCalendar: (code: string) =>
    request<GoogleCalendarStatus>('/integrations/google-calendar/callback', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  disconnectGoogleCalendar: () =>
    request<void>('/integrations/google-calendar/connection', { method: 'DELETE' }),
  /** Sync one course, or every course with a plan when no course is given - the Calendar's filter. */
  syncGoogleCalendar: (courseId?: string) =>
    request<GoogleSyncResult>(
      courseId
        ? `/integrations/google-calendar/sync?courseId=${encodeURIComponent(courseId)}`
        : '/integrations/google-calendar/sync',
      { method: 'POST' },
    ),

  /** The combined plan across every course with an exam date (FR3.1). */
  getStudentPlan: () => request<StudentPlan>('/schedule'),

  /** Downloads one course's plan as .ics so it can be imported into Google Calendar. */
  downloadScheduleIcs: (courseId: string, courseName: string) =>
    downloadIcs(`/courses/${courseId}/schedule.ics`, `${courseName.replace(/\s+/g, '-').toLowerCase()}.ics`),

  /** Downloads every course that fits as one .ics. */
  downloadStudentPlanIcs: () => downloadIcs('/schedule.ics', 'learnsprint-study-plan.ics'),

  getVelocity: () => request<Velocity>('/velocity'),

  getMembers: (courseId: string) => request<CourseMember[]>(`/courses/${courseId}/members`),

  inviteMember: (courseId: string, email: string) =>
    request<CourseMember>(`/courses/${courseId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),

  removeMember: (courseId: string, memberId: string) =>
    request<void>(`/courses/${courseId}/members/${memberId}`, { method: 'DELETE' }),
}
