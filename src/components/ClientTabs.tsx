import { Link, useLocation } from "react-router-dom";

export function ClientTabs({ clientId }: { clientId: string }) {
  const location = useLocation();
  const base = `/clients/${clientId}`;

  let active: "socials" | "folders" | "rights-manager" = "socials";
  if (location.pathname.startsWith(`${base}/combination-folders`)) active = "folders";
  else if (location.pathname.startsWith(`${base}/rights-manager`)) active = "rights-manager";

  return (
    <nav className="client-tabs" aria-label="Client sections">
      <Link to={base} className={`client-tab ${active === "socials" ? "active" : ""}`}>
        Socials
      </Link>
      <Link to={`${base}/combination-folders`} className={`client-tab ${active === "folders" ? "active" : ""}`}>
        Combination Folders
      </Link>
      <Link to={`${base}/rights-manager`} className={`client-tab ${active === "rights-manager" ? "active" : ""}`}>
        Rights Manager History
      </Link>
    </nav>
  );
}
