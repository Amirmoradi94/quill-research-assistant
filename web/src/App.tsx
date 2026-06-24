import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Home } from '@/pages/Home'
import { Professors } from '@/pages/Professors'
import { Drafts } from '@/pages/Drafts'
import { Discover } from '@/pages/Discover'
import { Batches } from '@/pages/Batches'
import { Sent } from '@/pages/Sent'
import { Documents } from '@/pages/Documents'
import { CalendarPage } from '@/pages/CalendarPage'
import { Settings } from '@/pages/Settings'
import { ProfessorDetail } from '@/pages/ProfessorDetail'
import { ActivityPage } from '@/pages/ActivityPage'
import { AiRuns } from '@/pages/AiRuns'
import { Profile } from '@/pages/Profile'
import { InterviewPrep } from '@/pages/InterviewPrep'
import { Login } from '@/pages/Login'
import { api } from '@/lib/api'

export default function App() {
  const [auth, setAuth] = useState<'loading' | 'in' | 'out'>('loading')

  useEffect(() => {
    api.authStatus()
      .then((status) => setAuth(status.authenticated ? 'in' : 'out'))
      .catch(() => setAuth('out'))
  }, [])

  const login = async (username: string, password: string) => {
    await api.login(username, password)
    setAuth('in')
  }

  if (auth === 'loading') {
    return (
      <div className="grid h-screen place-items-center text-[13px]"
        style={{ background: 'var(--color-paper)', color: 'var(--color-muted)' }}>
        Loading Quill...
      </div>
    )
  }

  return (
    <BrowserRouter>
      {auth === 'out' ? (
        <Routes>
          <Route path="/login" element={<Login onLogin={login} />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route element={<Layout />}>
            <Route index           element={<Home />} />
            <Route path="home"       element={<Home />} />
            <Route path="profile"    element={<Profile />} />
            <Route path="discover"   element={<Discover />} />
            <Route path="professors" element={<Professors />} />
            <Route path="professors/:id" element={<ProfessorDetail />} />
            <Route path="drafts"     element={<Drafts />} />
            <Route path="batches"    element={<Batches />} />
            <Route path="sent"       element={<Sent />} />
            <Route path="interview-prep" element={<InterviewPrep />} />
            <Route path="documents"  element={<Documents />} />
            <Route path="calendar"   element={<CalendarPage />} />
            <Route path="activity"   element={<ActivityPage />} />
            <Route path="ai-runs"    element={<AiRuns />} />
            <Route path="settings"   element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  )
}
