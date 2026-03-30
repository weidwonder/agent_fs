import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './auth/auth-context.js';
import { LoginPage } from './auth/login-page.js';
import { RegisterPage } from './auth/register-page.js';
import { Layout } from './components/layout.js';
import { ProjectListPage } from './projects/project-list-page.js';
import { ProjectDetailPage } from './projects/project-detail-page.js';
import { SearchPage } from './search/search-page.js';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Layout />
          </ProtectedRoute>
        }
      >
        <Route index element={<ProjectListPage />} />
        <Route path="projects/:id" element={<ProjectDetailPage />} />
        <Route path="search" element={<SearchPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
