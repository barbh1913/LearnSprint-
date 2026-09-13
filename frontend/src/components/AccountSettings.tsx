import { useState } from 'react'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog'
import { Button, Card, ErrorNote, Field, Input } from './ui/primitives'

const DELETE_WORD = 'DELETE'

/** The account card on the Profile page: email, change password, delete account (ADR 0014). */
export function AccountSettings() {
  const { user } = useAuth()

  return (
    <Card className="mb-4">
      <h2 className="mb-1 font-medium">Account</h2>
      <p className="mb-4 text-sm text-muted-foreground">{user?.email}</p>
      <ChangePasswordForm />
      <DeleteAccount />
    </Card>
  )
}

function ChangePasswordForm() {
  const [isOpen, setIsOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setIsSaving(true)
    try {
      await api.changePassword(currentPassword, newPassword)
      setNote('Password changed.')
      setCurrentPassword('')
      setNewPassword('')
      setIsOpen(false)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not change the password')
    } finally {
      setIsSaving(false)
    }
  }

  if (!isOpen) {
    return (
      <div className="mb-4 flex items-center gap-3">
        <Button
          onClick={() => {
            setIsOpen(true)
            setNote('')
          }}
        >
          Change password
        </Button>
        {note && (
          <p role="status" className="text-sm text-muted-foreground">
            {note}
          </p>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mb-4 max-w-sm space-y-3">
      <Field label="Current password">
        <Input
          type="password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          autoComplete="current-password"
        />
      </Field>
      <Field label="New password">
        <Input
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="At least 8 characters"
          required
          minLength={8}
          autoComplete="new-password"
        />
      </Field>

      {error && <ErrorNote message={error} />}

      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={isSaving}>
          {isSaving ? 'Saving' : 'Save new password'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setIsOpen(false)
            setError('')
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

function DeleteAccount() {
  const { deleteAccount } = useAuth()
  const [isOpen, setIsOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  async function handleDelete() {
    setError('')
    setIsDeleting(true)
    try {
      await deleteAccount(typed)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not delete the account')
      setIsDeleting(false)
    }
  }

  return (
    <div className="border-t border-border pt-4">
      <p className="mb-2 text-sm text-muted-foreground">
        Deleting your account removes your courses, progress and uploaded files. Courses you own
        disappear for every member; courses you joined keep running without you.
      </p>
      <Button variant="danger" onClick={() => setIsOpen(true)}>
        Delete account
      </Button>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open)
          if (!open) {
            setTyped('')
            setError('')
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>Delete your account?</DialogTitle>
          <DialogDescription>
            This cannot be undone. Type <strong>{DELETE_WORD}</strong> to confirm.
          </DialogDescription>

          <Field label={`Type ${DELETE_WORD}`}>
            <Input
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
              autoFocus
            />
          </Field>

          {error && <ErrorNote message={error} />}

          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setIsOpen(false)}>
              Keep my account
            </Button>
            <Button
              variant="danger"
              disabled={typed !== DELETE_WORD || isDeleting}
              onClick={() => void handleDelete()}
            >
              {isDeleting ? 'Deleting' : 'Delete everything'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
