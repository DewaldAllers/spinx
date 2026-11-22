self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SpinX Live</title><body style="background:#0c110e;color:#f3f6f1;font:1rem system-ui;padding:2rem"><h1>SpinX Live</h1><p>Reconnect to the network to open your class.</p><a href="" style="color:#bffa6b">Try again</a></body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )))
})
