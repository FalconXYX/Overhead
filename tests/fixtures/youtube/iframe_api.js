// tests/fixtures/youtube/iframe_api.js — a hand-written stand-in for https://www.youtube.com/iframe_api (M5 step 14.2),
// served by the e2e `routes` fixture. It mirrors the real widget closely enough for the app's lifecycle: YT.Player
// swaps its host for an iframe (srcdoc, so no request) and destroy() puts the host back; onReady after a 0 ms timeout,
// then state −1; playVideo emits 3 then 1 (or onAutoplayBlocked); getCurrentTime() extrapolates by up to 1 s while
// playing; getMediaReferenceTime exists only while window.__ytStub.mediaReferenceSec is a number. Test hooks live on
// window.__ytStub.
(() => {
  "use strict";
  const ID = /^[A-Za-z0-9_-]{11}$/;
  const STATE = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

  const stub = {
    /** Every YT.Player created, in order. */
    players: [],
    /** The options each YT.Player was created with. */
    options: [],
    /** { fn } per method call; playVideo adds visibleFraction and muted, setSize adds w and h. */
    calls: [],
    /** [clientX, clientY] of every click inside a player's iframe. */
    clicks: [],
    /** The stream's media time, seconds (the real Subaru stream reported about 4.4 million). */
    mediaSec: 4399105.5,
    /** Date.now() / 1000 when mediaSec was last set or the state last changed. */
    updatedAtSec: Date.now() / 1000,
    /** UTC seconds for getMediaReferenceTime, or null: then the method does not exist. */
    mediaReferenceSec: null,
    /** true: playVideo fires onAutoplayBlocked instead of playing. */
    autoplayBlocked: false,
    /** The players not destroyed. */
    live() {
      return stub.players.filter((p) => !p.destroyed);
    },
    setMedia(sec) {
      stub.mediaSec = sec;
      stub.updatedAtSec = Date.now() / 1000;
    },
    /** onStateChange(code) on every live player. */
    emitState(code) {
      for (const p of stub.live()) p.emitState(code);
    },
    /** onError(code) on every live player (101, 150 and 153 block the embed). */
    emitError(code) {
      for (const p of stub.live()) p.fire("onError", { target: p.api, data: code });
    },
  };
  window.__ytStub = stub;

  /** The share of the element's box inside the viewport. */
  function visibleFraction(el) {
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (!(area > 0)) return 0;
    const w = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
    const h = Math.max(0, Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0));
    return (w * h) / area;
  }

  const SRCDOC =
    "<!doctype html><html><head><style>html,body{margin:0;height:100%;background:#000}</style></head>" +
    "<body></body></html>";

  class StubPlayer {
    constructor(host, options) {
      if (!ID.test(String(options && options.videoId))) throw new Error("Invalid video id");
      this.host = host;
      this.options = options;
      this.events = options.events || {};
      this.state = STATE.UNSTARTED;
      this.muted = false;
      this.destroyed = false;
      const iframe = document.createElement("iframe");
      iframe.setAttribute("srcdoc", SRCDOC);
      iframe.setAttribute("frameborder", "0");
      iframe.setAttribute("allowfullscreen", "");
      iframe.setAttribute("title", "YouTube video player");
      iframe.setAttribute("width", String(options.width));
      iframe.setAttribute("height", String(options.height));
      iframe.addEventListener("load", () => {
        const win = iframe.contentWindow;
        if (win === null) return;
        win.addEventListener("click", (e) => stub.clicks.push([e.clientX, e.clientY]));
        // As the real player: f makes its own document fullscreen (fs: 0 removes only the button, G3).
        win.addEventListener("keydown", (e) => {
          if (e.key === "f") win.document.documentElement.requestFullscreen().catch(() => {});
        });
      });
      this.iframe = iframe;
      host.replaceWith(iframe);
      stub.options.push(options);
      stub.players.push(this);
      const self = this;
      // The API object the app sees: only the documented methods, plus the undocumented one while set.
      this.api = {
        playVideo() {
          self.call({ fn: "playVideo", visibleFraction: visibleFraction(iframe), muted: self.muted });
          if (stub.autoplayBlocked) {
            setTimeout(() => self.fire("onAutoplayBlocked", { target: self.api }), 0);
            return;
          }
          setTimeout(() => self.emitState(STATE.BUFFERING), 0);
          setTimeout(() => self.emitState(STATE.PLAYING), 0);
        },
        pauseVideo() {
          self.call({ fn: "pauseVideo" });
          setTimeout(() => self.emitState(STATE.PAUSED), 0);
        },
        mute() {
          self.call({ fn: "mute" });
          self.muted = true;
        },
        getCurrentTime() {
          if (self.state !== STATE.PLAYING) return stub.mediaSec;
          const ahead = Math.min(1, Math.max(0, Date.now() / 1000 - stub.updatedAtSec));
          return stub.mediaSec + ahead;
        },
        getPlayerState() {
          return self.state;
        },
        setSize(w, h) {
          self.call({ fn: "setSize", w, h });
          iframe.setAttribute("width", String(w));
          iframe.setAttribute("height", String(h));
        },
        getIframe() {
          return iframe;
        },
        destroy() {
          self.call({ fn: "destroy" });
          self.destroyed = true;
          if (iframe.isConnected) iframe.replaceWith(self.host);
        },
      };
      Object.defineProperty(this.api, "getMediaReferenceTime", {
        enumerable: false,
        get() {
          return typeof stub.mediaReferenceSec === "number" ? () => stub.mediaReferenceSec : undefined;
        },
      });
      setTimeout(() => {
        if (this.destroyed) return;
        this.fire("onReady", { target: this.api });
        this.emitState(STATE.UNSTARTED);
      }, 0);
    }

    call(entry) {
      stub.calls.push(entry);
    }

    fire(name, event) {
      if (this.destroyed) return;
      const handler = this.events[name];
      if (typeof handler === "function") handler(event);
    }

    emitState(code) {
      if (this.destroyed) return;
      this.state = code;
      stub.updatedAtSec = Date.now() / 1000;
      this.fire("onStateChange", { target: this.api, data: code });
    }
  }

  /** `new YT.Player(host, options)` returns the API object, as the real constructor's instance does. */
  function Player(host, options) {
    return new StubPlayer(host, options).api;
  }

  window.YT = { Player, PlayerState: STATE };
  setTimeout(() => {
    if (typeof window.onYouTubeIframeAPIReady === "function") window.onYouTubeIframeAPIReady();
  }, 0);
})();
