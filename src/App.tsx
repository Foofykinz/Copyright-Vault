import { Route, Routes } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { HomePage } from "./pages/HomePage";
import { ClientPage } from "./pages/ClientPage";
import { SocialAccountPage } from "./pages/SocialAccountPage";
import { CombinationFoldersIndexPage } from "./pages/CombinationFoldersIndexPage";
import { CombinationFolderPage } from "./pages/CombinationFolderPage";

export default function App() {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="main">
        <div className="main-scroll">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/clients/:clientId" element={<ClientPage />} />
            <Route path="/clients/:clientId/social/:accountId" element={<SocialAccountPage />} />
            <Route path="/folders" element={<CombinationFoldersIndexPage />} />
            <Route path="/folders/:folderId" element={<CombinationFolderPage />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}
