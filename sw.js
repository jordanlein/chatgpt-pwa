const CACHE_NAME = 'llm-chat-pwa-cache-v1';
const urlsToCache = [
    '/',
    '/index.html',
    '/style.css',
    '/app.js',
    '/manifest.json',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png'
    // Add other critical assets if any
];

// Install event: Cache core assets (App Shell)
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Opened cache');
                return cache.addAll(urlsToCache);
            })
            .catch(err => {
                console.error('Failed to cache urls:', err);
            })
    );
});

// Activate event: Clean up old caches
self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        console.log('Deleting old cache:', cacheName);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
    return self.clients.claim(); // Ensure new service worker takes control immediately
});

// Fetch event: Serve from cache or network (Cache-First for App Shell)
self.addEventListener('fetch', event => {
    // We only want to apply cache-first to requests for our app shell assets
    if (urlsToCache.some(url => event.request.url.endsWith(url) || event.request.url === self.location.origin + '/')) {
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    // Cache hit - return response
                    if (response) {
                        return response;
                    }
                    // Not in cache - fetch from network, then cache it for next time
                    return fetch(event.request).then(
                        networkResponse => {
                            // Check if we received a valid response
                            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                                return networkResponse;
                            }

                            const responseToCache = networkResponse.clone();
                            caches.open(CACHE_NAME)
                                .then(cache => {
                                    cache.put(event.request, responseToCache);
                                });
                            return networkResponse;
                        }
                    );
                })
                .catch(error => {
                    console.error('Cache match error or fetch error:', error);
                    // You could return a custom offline page here if desired for navigation requests
                    // For now, just let the browser handle the network error
                })
        );
    } else {
        // For other requests (like API calls, external resources), just fetch from network
        // Or implement a network-first or stale-while-revalidate strategy if needed
        event.respondWith(fetch(event.request));
    }
});