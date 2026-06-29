"use strict";

browser.runtime.onMessage.addListener((message) => {
  if (message.type === "PING") return Promise.resolve({ pong: true });
});
