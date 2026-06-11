import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Home } from '@/pages/Home'
import { Professors } from '@/pages/Professors'
import { Drafts } from '@/pages/Drafts'
import { Grants } from '@/pages/Grants'
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
import { Setup } from '@/pages/Setup'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index           element={<Home />} />
          <Route path="home"       element={<Home />} />
          <Route path="setup"      element={<Setup />} />
          <Route path="profile"    element={<Profile />} />
          <Route path="discover"   element={<Discover />} />
          <Route path="professors" element={<Professors />} />
          <Route path="professors/:id" element={<ProfessorDetail />} />
          <Route path="drafts"     element={<Drafts />} />
          <Route path="batches"    element={<Batches />} />
          <Route path="sent"       element={<Sent />} />
          <Route path="interview-prep" element={<InterviewPrep />} />
          <Route path="grants"     element={<Grants />} />
          <Route path="documents"  element={<Documents />} />
          <Route path="calendar"   element={<CalendarPage />} />
          <Route path="activity"   element={<ActivityPage />} />
          <Route path="ai-runs"    element={<AiRuns />} />
          <Route path="settings"   element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
