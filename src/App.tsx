import { Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { ExtensionInstallBanner } from "./components/ExtensionInstallBanner";
import { HomePage } from "./pages/HomePage";
import { ClientPage } from "./pages/ClientPage";
import { SocialAccountPage } from "./pages/SocialAccountPage";
import { CombinationFoldersIndexPage } from "./pages/CombinationFoldersIndexPage";
import { CombinationFolderPage } from "./pages/CombinationFolderPage";
import { ExtensionPage } from "./pages/ExtensionPage";
import { LoginPage } from "./pages/LoginPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { useAuth } from "./hooks/useAuth";
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
    <div className="app-shell">
      <Sidebar user={user} onLogout={logout} />
      <div className="main">
        <ExtensionInstallBanner />
        <div className="main-scroll">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/clients/:clientId" element={<ClientPage />} />
            <Route path="/clients/:clientId/social/:accountId" element={<SocialAccountPage />} />
            <Route path="/folders" element={<CombinationFoldersIndexPage />} />
            <Route path="/folders/:folderId" element={<CombinationFolderPage />} />
            <Route path="/extension" element={<ExtensionPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
