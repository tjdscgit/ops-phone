// Hash router.
//
// Hash routing rather than the History API because the app is served from a
// GitHub Pages subpath with no server to rewrite deep links — a real path
// like /tasks/123 would 404 on refresh.

const routes = [];
let mount = null;
let onNavigate = null;

// `pattern` is a path with :params, e.g. '/c/:key/:id'.
export function route(pattern, handler) {
  const names = [];
  const rx = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, n) => {
    names.push(n);
    return '([^/]+)';
  }) + '$', 'i');
  routes.push({ rx, names, handler });
}

export function go(hash) {
  if (!hash) return;
  if (location.hash === hash) render();
  else location.hash = hash;
}

export const back = () => history.back();

export const currentPath = () =>
  (location.hash.replace(/^#/, '') || '/today').replace(/\/+$/, '') || '/today';

export async function render() {
  const path = currentPath();

  for (const { rx, names, handler } of routes) {
    const m = path.match(rx);
    if (!m) continue;
    const params = Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
    // Views render into a fresh node and swap it in, so a slow load can't
    // paint over a screen the user has already navigated away from.
    mount.scrollTop = 0;
    window.scrollTo(0, 0);
    onNavigate?.(path);
    try {
      await handler(mount, params);
    } catch (err) {
      mount.replaceChildren(
        Object.assign(document.createElement('div'), {
          className: 'card hint',
          textContent: err?.message || String(err),
        }),
      );
    }
    return;
  }

  go('#/today');
}

export function startRouter(mountNode, navCallback) {
  mount = mountNode;
  onNavigate = navCallback;
  window.addEventListener('hashchange', render);
  render();
}
