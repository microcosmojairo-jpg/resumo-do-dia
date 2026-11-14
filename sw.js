/* Guarda o app e os últimos resumos no celular para funcionar sem internet. */
const VERSAO = "resumo-v1";
const ARQUIVOS = ["./", "index.html", "estilo.css", "app.js", "manifest.webmanifest", "privacidade.html", "icones/icone-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Primeiro tenta a internet (para pegar o resumo novo); sem internet, usa o que está guardado.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copia = r.clone();
      caches.open(VERSAO).then((c) => c.put(e.request, copia));
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
