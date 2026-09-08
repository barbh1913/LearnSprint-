// Typed wrapper around the backend API. Every call goes through `request`, so
// the auth header and error handling live in exactly one place.

import type {
  AiSettings,
  Board,
  Course,
  CourseMember,
  ExamType,
  Grades,
  MasteryLevel,
  Schedule,
  Sprint,
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

  updateTopic: (courseId: string, topicId: string, changes: Partial<Topic>) =>
    request<Topic>(`/courses/${courseId}/topics/${topicId}`, {
      method: 'PATCH',
      body: JSON.stringify(changes),
    }),

  deleteTopic: (courseId: string, topicId: string) =>
    request<void>(`/courses/${courseId}/topics/${topicId}`, { method: 'DELETE' }),

  updateAction: (courseId: string, topicId: string, actionId: string, durationMinutes: number) =>
    request<{ id: string; topicId: string; type: string; durationMinutes: number }>(
      `/courses/${courseId}/topics/${topicId}/actions/${actionId}`,
      { method: 'PATCH', body: JSON.stringify({ durationMinutes }) },
    ),

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

  /** Downloads the plan as .ics so it can be imported into Google Calendar. */
  downloadScheduleIcs: async (courseId: string, courseName: string) => {
    const response = await fetch(apiUrl(`/courses/${courseId}/schedule.ics`), {
      headers: { Authorization: `Bearer ${getToken()}` },
    })
    if (!response.ok) {
      throw new ApiError(await readErrorMessage(response), response.status)
    }

    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = `${courseName.replace(/\s+/g, '-').toLowerCase()}.ics`
    link.click()
    URL.revokeObjectURL(url)
  },

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
