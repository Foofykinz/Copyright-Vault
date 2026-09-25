import { Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ExtensionInstallBanner } from "./components/ExtensionInstallBanner";
import { HomePage } from "./pages/HomePage";
import { ClientPage } from "./pages/ClientPage";
import { SocialAccountPage } from "./pages/SocialAccountPage";
import { ClientCombinationFoldersPage } from "./pages/ClientCombinationFoldersPage";
import { CombinationFolderPage } from "./pages/CombinationFolderPage";
import { RightsManagerHistoryPage } from "./pages/RightsManagerHistoryPage";
import { RightsManagerArchivePage } from "./pages/RightsManagerArchivePage";
import { InfringementReportsPage } from "./pages/InfringementReportsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { DeadlinesPage } from "./pages/DeadlinesPage";
import { ExtensionPage } from "./pages/ExtensionPage";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { useAuth } from "./hooks/useAuth";
import { CurrentUserContext } from "./hooks/useCurrentUser";
import { LoadingBlock } from "./components/StateBlock";

export default function App() {
  const { user, loading, refetch, logout } = useAuth();

  if (loading) {
    return (
      <div className="auth-shell">
        <LoadingBlock label="Loading…" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoggedIn={refetch} />;
  }

  if (user.mustChangePassword) {
    return <ChangePasswordPage onChanged={refetch} />;
  }

  return (
    <CurrentUserContext.Provider value={user}>
      <div className="app-shell">
        <Sidebar user={user} onLogout={logout} />
        <div className="main">
          <ExtensionInstallBanner />
          <div className="main-scroll">
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/clients/:clientId" element={<ClientPage />} />
              <Route path="/clients/:clientId/social/:accountId" element={<SocialAccountPage />} />
              <Route path="/clients/:clientId/combination-folders" element={<ClientCombinationFoldersPage />} />
              <Route path="/clients/:clientId/combination-folders/:folderId" element={<CombinationFolderPage />} />
              <Route path="/clients/:clientId/rights-manager" element={<RightsManagerHistoryPage />} />
              <Route path="/rights-manager" element={<RightsManagerArchivePage />} />
              <Route path="/infringements" element={<InfringementReportsPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/deadlines" element={<DeadlinesPage />} />
              <Route path="/extension" element={<ExtensionPage />} />
            </Routes>
          </div>
        </div>
      </div>
    </CurrentUserContext.Provider>
  );
}
