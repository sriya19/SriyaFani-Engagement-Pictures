self.addEventListener("push", (event) => {
  const kind = event.data?.text();
  const host = kind === "request";
  const target = new URL(host ? "host?tab=guests" : "?album=1", self.registration.scope).href;
  const title = host ? "New album access request" : "Your album access is approved";
  event.waitUntil(self.registration.showNotification(title, {
    body: host ? "Open the host studio to review the guest’s name and mobile number." : "Tap to see Sriya and Fani’s engagement photos.",
    icon: new URL("lotus-192.png", self.registration.scope).href,
    tag: host ? "album-requests" : "album-approval", data: { target },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data.target);
  if (target.origin !== self.location.origin || !target.href.startsWith(self.registration.scope)) return;
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({type:"window", includeUncontrolled:true});
    const page = list.find(client => new URL(client.url).pathname === target.pathname);
    if (page) {
      const navigated = await page.navigate(target.href);
      if (navigated) return navigated.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
