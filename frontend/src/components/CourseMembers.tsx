import { useCallback, useEffect, useState } from 'react'
import { Trash2, UserPlus, Users } from 'lucide-react'
import { api, ApiError } from '../api/client'
import type { CourseMember } from '../types'
import { Badge, Button, Card, ErrorNote, Input, ProgressBar, Spinner } from './ui/primitives'

/** Study group panel for one course (FR5.1-FR5.4).
 *
 * Shows who else is on the course and how far along they are. Deliberately no
 * grades and no schedules - the API doesn't send them, and seeing a classmate's
 * pace is the point, not comparing marks.
 */
export function CourseMembers({ courseId }: { courseId: string }) {
  const [members, setMembers] = useState<CourseMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [isInviting, setIsInviting] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setMembers(await api.getMembers(courseId))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load members')
    } finally {
      setIsLoading(false)
    }
  }, [courseId])

  useEffect(() => {
    void load()
  }, [load])

  const me = members.find((member) => member.isMe)
  const canInvite = me?.role === 'owner'

  async function invite(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) return

    setIsInviting(true)
    try {
      await api.inviteMember(courseId, trimmed)
      setEmail('')
      setError('')
      await load()
    } catch (inviteError) {
      setError(
        inviteError instanceof ApiError
          ? inviteError.message
          : 'Could not invite that person',
      )
    } finally {
      setIsInviting(false)
    }
  }

  async function remove(member: CourseMember) {
    const question = member.isMe
      ? 'Leave this course? Your own progress is kept.'
      : `Remove ${member.email} from this course?`
    if (!window.confirm(question)) return

    try {
      await api.removeMember(courseId, member.userId)
      if (member.isMe) {
        window.location.href = '/courses'
        return
      }
      await load()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove member')
    }
  }

  if (isLoading) return <Spinner label="Loading study group" />

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2">
        <Users className="size-4 text-muted-foreground" aria-hidden />
        <h2 className="font-medium">Study group</h2>
      </div>
      <p className="mb-4 text-sm text-muted-foreground">
        Everyone here shares the same topic list. Schedules, grades and mastery ratings stay
        private to each person.
      </p>

      {error && <ErrorNote message={error} />}

      <ul className="mb-4 flex flex-col gap-3">
        {members.map((member) => (
          <li key={member.userId} className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {member.isMe ? 'You' : member.email}
                </span>
                {member.role === 'owner' && <Badge>owner</Badge>}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <ProgressBar value={member.topicsDone} max={Math.max(1, member.topicsTotal)} />
                <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {member.topicsDone}/{member.topicsTotal} done
                </span>
              </div>
            </div>

            {(canInvite || member.isMe) && member.role !== 'owner' && (
              <Button
                variant="ghost"
                onClick={() => void remove(member)}
                aria-label={member.isMe ? 'Leave this course' : `Remove ${member.email}`}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canInvite && (
        <form onSubmit={invite} className="flex gap-2">
          <Input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="classmate@university.ac.il"
            aria-label="Invite a classmate by email"
          />
          <Button type="submit" disabled={isInviting || !email.trim()}>
            <UserPlus className="size-4" aria-hidden />
            {isInviting ? 'Inviting' : 'Invite'}
          </Button>
        </form>
      )}
    </Card>
  )
}
