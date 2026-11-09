import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/components/Toast'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import Layout from '@/components/Layout'
import Home from '@/pages/Home'
import Login from '@/pages/Login'
import InitAdmin from '@/pages/InitAdmin'
import Overview from '@/pages/dashboard/Overview'
import Links from '@/pages/dashboard/Links'
import LinkDetail from '@/pages/dashboard/LinkDetail'
import Groups from '@/pages/dashboard/Groups'
import Review from '@/pages/dashboard/Review'
import Analytics from '@/pages/dashboard/Analytics'
import Users from '@/pages/dashboard/Users'
import Audit from '@/pages/dashboard/Audit'
import Domains from '@/pages/dashboard/Domains'
import Settings from '@/pages/dashboard/Settings'
import Profile from '@/pages/dashboard/Profile'
import NotFound from '@/pages/NotFound'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/init" element={<InitAdmin />} />

          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route
              index
              element={
                <ProtectedRoute roles={['super_admin']}>
                  <Overview />
                </ProtectedRoute>
              }
            />
            <Route path="links" element={<Links />} />
            <Route path="links/:id" element={<LinkDetail />} />
            <Route path="groups" element={<Groups />} />
            <Route
              path="review"
              element={
                <ProtectedRoute groupAdmin>
                  <Review />
                </ProtectedRoute>
              }
            />
            <Route
              path="stats"
              element={
                <ProtectedRoute roles={['super_admin']}>
                  <Analytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute roles={['super_admin']}>
                  <Users />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute roles={['super_admin']}>
                  <Audit />
                </ProtectedRoute>
              }
            />
            <Route
              path="domains"
              element={
                <ProtectedRoute roles={['super_admin']}>
                  <Domains />
                </ProtectedRoute>
              }
            />
            <Route
              path="settings"
              element={
                <ProtectedRoute roles={['super_admin']}>
                  <Settings />
                </ProtectedRoute>
              }
            />
            <Route path="profile" element={<Profile />} />
          </Route>

          <Route path="*" element={<NotFound />} />
        </Routes>
      </ToastProvider>
    </AuthProvider>
  )
}
