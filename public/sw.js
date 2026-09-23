const CACHE_NAME = 'lumenwake-shell-v9';
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './assets/game/hero-0.png',
  './assets/game/hero-1.png',
  './assets/game/hero-2.png',
  './assets/game/hero-3.png',
  './assets/game/hero-4.png',
  './assets/game/enemy-shadow-0.png',
  './assets/game/enemy-shadow-1.png',
  './assets/game/enemy-shadow-2.png',
  './assets/game/enemy-shadow-3.png',
  './assets/game/enemy-golem-0.png',
  './assets/game/enemy-golem-1.png',
  './assets/game/enemy-golem-2.png',
  './assets/game/enemy-golem-3.png',
  './assets/game/projectile.png',
  './assets/game/impact.png',
  './assets/game/xp-coin.png',
  './assets/game/terrain-grass.png',
  './assets/game/terrain-grass-dark.png',
  './assets/game/terrain-flowers.png',
  './assets/game/terrain-dirt.png',
  './assets/game/terrain-sand.png',
  './assets/game/terrain-stone.png',
  './assets/game/terrain-water.png',
  './assets/game/prop-bush.png',
  './assets/game/prop-flowers.png',
  './assets/game/prop-rock.png',
  './assets/game/prop-mushrooms.png',
  './assets/game/prop-ground-flowers.png',
  './assets/game/building-house.png',
  './assets/game/building-tower.png',
  './assets/game/building-fence.png',
  './assets/game/building-well.png',
  './assets/game/building-shrine.png',
];

async function cacheAppShell() {
  const cache = await caches.open(CACHE_NAME);
  const response = await fetch('./', { cache: 'no-store' });
  await cache.put('./', response.clone());
  const html = await response.text();
  const urls = new Set(CORE_ASSETS.map((asset) => new URL(asset, self.registration.scope).toString()));
  for (const match of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    const url = new URL(match[1], self.registration.scope).toString();
    if (url.startsWith(self.registration.scope) && !url.endsWith('/sw.js')) urls.add(url);
  }
  await cache.addAll([...urls]);
}

self.addEventListener('install', (event) => {
  event.waitUntil(cacheAppShell().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request, { ignoreVary: true }).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => {
        if (event.request.mode === 'navigate') return caches.match('./', { ignoreVary: true });
        return Response.error();
      });
    }),
  );
});
