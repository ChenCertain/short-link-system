import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import { AuthProvider } from '@/contexts/AuthContext'
import { ToastProvider } from '@/components/Toast'
import { ProtectedRoute } from '@/components/ProtectedRoute'
import ErrorBoundary from '@/components/ErrorBoundary'
import Layout from '@/components/Layout'

// 页面全部按需加载，显著减小首屏 JS 体积
const Home = lazy(() => import('@/pages/Home'))
const Login = lazy(() => import('@/pages/Login'))
const InitAdmin = lazy(() => import('@/pages/InitAdmin'))
const Overview = lazy(() => import('@/pages/dashboard/Overview'))
const Links = lazy(() => import('@/pages/dashboard/Links'))
const LinkDetail = lazy(() => import('@/pages/dashboard/LinkDetail'))
const Groups = lazy(() => import('@/pages/dashboard/Groups'))
const Review = lazy(() => import('@/pages/dashboard/Review'))
const Analytics = lazy(() => import('@/pages/dashboard/Analytics'))
const Users = lazy(() => import('@/pages/dashboard/Users'))
const Audit = lazy(() => import('@/pages/dashboard/Audit'))
const Domains = lazy(() => import('@/pages/dashboard/Domains'))
const Settings = lazy(() => import('@/pages/dashboard/Settings'))
const Profile = lazy(() => import('@/pages/dashboard/Profile'))
const NotFound = lazy(() => import('@/pages/NotFound'))

function PageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
    </div>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<PageLoading />}>
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
                    <ProtectedRoute groupPermission="link.review">
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
                    <ProtectedRoute globalPermission="user.manage">
                      <Users />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="audit"
                  element={
                    <ProtectedRoute globalPermission="audit.view">
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
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </ErrorBoundary>
  )
}
