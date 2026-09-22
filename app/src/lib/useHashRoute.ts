// Minimal hash router. The app has no routing library, and one extra page
// doesn't justify adding one — hash routes also need no server rewrite rules
// on Cloudflare Pages, so a hard refresh on #/notes just serves index.html.
//
//   ''            → { name: 'planner' }
//   '#/'          → { name: 'planner' }
//   '#/notes'     → { name: 'notes', id: null }
//   '#/notes/:id' → { name: 'notes', id: ':id' }

import { useEffect, useState } from 'react';

export type Route = { name: 'planner' } | { name: 'notes'; id: string | null };

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  if (!path) return { name: 'planner' };
  const [head, id] = path.split('/');
  if (head === 'notes') return { name: 'notes', id: id ? decodeURIComponent(id) : null };
  return { name: 'planner' };
}

export function goNotes(id?: string) {
  window.location.hash = id ? `#/notes/${encodeURIComponent(id)}` : '#/notes';
}

export function goPlanner() {
  window.location.hash = '#/';
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onHash = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return route;
}
