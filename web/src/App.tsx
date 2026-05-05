import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { Home } from '@/pages/Home'
import { Placeholder } from '@/pages/Placeholder'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index           element={<Home />} />
          <Route path="discover"   element={<Placeholder title="Discover"   section="16" />} />
          <Route path="professors" element={<Placeholder title="Professors" section="9" />} />
          <Route path="drafts"     element={<Placeholder title="Drafts"     section="17" />} />
          <Route path="batches"    element={<Placeholder title="Batches"    section="23" />} />
          <Route path="grants"     element={<Placeholder title="Grants"     section="22" />} />
          <Route path="documents"  element={<Placeholder title="Documents"  section="20" />} />
          <Route path="calendar"   element={<Placeholder title="Calendar"   section="19" />} />
          <Route path="activity"   element={<Placeholder title="Activity"   section="24" />} />
          <Route path="ai-runs"    element={<Placeholder title="AI Runs"    section="24" />} />
          <Route path="settings"   element={<Placeholder title="Settings"   section="21" />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
