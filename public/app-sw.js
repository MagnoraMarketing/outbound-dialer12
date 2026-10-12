// Minimal service worker for the installable Nordcall app. It only passes
// requests through to the network; all data is always fetched live.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
