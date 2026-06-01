import { useState, useEffect, useCallback } from "react";

export type HashRoute =
  | { page: "dashboard" }
  | { page: "paper-workspace"; paperId: string }
  | { page: "paper-generate"; paperId: string }
  | { page: "paper-chat"; paperId: string }
  | { page: "paper-create" }
  | { page: "paper-section"; paperId: string; sectionNumber: string }
  | { page: "paper-literature"; paperId: string }
  | { page: "paper-detection"; paperId: string }
  | { page: "paper-export"; paperId: string }
  | { page: "services" }
  | { page: "service-detail"; serviceId: string }
  | { page: "logs" }
  | { page: "import-word"; paperId: string }
  | { page: "doctor" };

function parseHash(hash: string): HashRoute {
  const path = hash.replace(/^#\/?/, "");

  if (!path || path === "/") return { page: "dashboard" };
  if (path === "config" || path === "services") return { page: "services" };
  if (path === "logs") return { page: "logs" };
  if (path === "doctor") return { page: "doctor" };
  if (path === "paper/new") return { page: "paper-create" };

  const serviceMatch = path.match(/^services\/([^/]+)$/);
  if (serviceMatch) return { page: "service-detail", serviceId: decodeURIComponent(serviceMatch[1]) };

  const sectionMatch = path.match(/^paper\/([^/]+)\/section\/([^/]+)$/);
  if (sectionMatch) return { page: "paper-section", paperId: decodeURIComponent(sectionMatch[1]), sectionNumber: decodeURIComponent(sectionMatch[2]) };

  const workspaceMatch = path.match(/^paper\/([^/]+)\/workspace$/);
  if (workspaceMatch) return { page: "paper-workspace", paperId: decodeURIComponent(workspaceMatch[1]) };

  const generateMatch = path.match(/^paper\/([^/]+)\/generate$/);
  if (generateMatch) return { page: "paper-generate", paperId: decodeURIComponent(generateMatch[1]) };

  const literatureMatch = path.match(/^paper\/([^/]+)\/literature$/);
  if (literatureMatch) return { page: "paper-literature", paperId: decodeURIComponent(literatureMatch[1]) };

  const detectionMatch = path.match(/^paper\/([^/]+)\/detection$/);
  if (detectionMatch) return { page: "paper-detection", paperId: decodeURIComponent(detectionMatch[1]) };

  const exportMatch = path.match(/^paper\/([^/]+)\/export$/);
  if (exportMatch) return { page: "paper-export", paperId: decodeURIComponent(exportMatch[1]) };

  const importWordMatch = path.match(/^paper\/([^/]+)\/import-word$/);
  if (importWordMatch) return { page: "import-word", paperId: decodeURIComponent(importWordMatch[1]) };

  const chatMatch = path.match(/^paper\/([^/]+)\/chat$/);
  if (chatMatch) return { page: "paper-chat", paperId: decodeURIComponent(chatMatch[1]) };

  const paperMatch = path.match(/^paper\/([^/]+)$/);
  if (paperMatch) return { page: "paper-generate", paperId: decodeURIComponent(paperMatch[1]) };

  return { page: "dashboard" };
}

function routeToHash(route: HashRoute): string {
  switch (route.page) {
    case "dashboard": return "#/";
    case "paper-workspace": return `#/paper/${encodeURIComponent(route.paperId)}/workspace`;
    case "paper-generate": return `#/paper/${encodeURIComponent(route.paperId)}/generate`;
    case "paper-chat": return `#/paper/${encodeURIComponent(route.paperId)}/chat`;
    case "paper-create": return "#/paper/new";
    case "paper-section": return `#/paper/${encodeURIComponent(route.paperId)}/section/${encodeURIComponent(route.sectionNumber)}`;
    case "paper-literature": return `#/paper/${encodeURIComponent(route.paperId)}/literature`;
    case "paper-detection": return `#/paper/${encodeURIComponent(route.paperId)}/detection`;
    case "paper-export": return `#/paper/${encodeURIComponent(route.paperId)}/export`;
    case "import-word": return `#/paper/${encodeURIComponent(route.paperId)}/import-word`;
    case "services": return "#/services";
    case "service-detail": return `#/services/${encodeURIComponent(route.serviceId)}`;
    case "logs": return "#/logs";
    case "doctor": return "#/doctor";
  }
}

export { parseHash, routeToHash }; // for testing

const HASH_PAGES = new Set(["dashboard", "paper-workspace", "paper-generate", "paper-chat", "paper-create", "paper-section", "paper-literature", "paper-detection", "paper-export", "import-word", "services", "service-detail", "logs", "doctor"]);

export function useHashRoute() {
  const [route, setRouteState] = useState<HashRoute>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHashChange = () => setRouteState(parseHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const setRoute = useCallback((newRoute: HashRoute) => {
    setRouteState(newRoute);
    if (HASH_PAGES.has(newRoute.page)) {
      const hash = routeToHash(newRoute);
      if (hash && window.location.hash !== hash) {
        window.location.hash = hash;
      }
    }
  }, []);

  const nav = {
    toServices: () => setRoute({ page: "services" }),
    toServiceDetail: (id: string) => setRoute({ page: "service-detail", serviceId: id }),
  };

  return { route, setRoute, nav };
}
