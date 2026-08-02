(() => {
  const preloader = document.getElementById("preloader");
  const video = document.querySelector(".logo-video");
  if (!preloader) return;

  const MIN_DURATION = 2000; // ms, always shown at least this long
  // Safety net only -- if the video somehow never becomes ready (a
  // network hiccup, a blocked request), the page shouldn't stay stuck
  // behind a black screen forever.
  const MAX_WAIT = 8000;
  const FADE_DURATION = 300;

  const start = performance.now();
  let videoReady = !video || video.readyState >= 2;
  let pageLoaded = document.readyState === "complete";
  let finished = false;

  function hidePreloader() {
    if (finished) return;
    finished = true;
    preloader.classList.add("is-hidden");
    setTimeout(() => {
      preloader.hidden = true;
    }, FADE_DURATION);
  }

  // "Properly loaded" = the logo decal's video is ready to paint AND the
  // page's own resources (fonts, images) have settled -- whichever of the
  // two takes longer, capped below by the minimum and above by the safety
  // net timeout.
  function maybeFinish() {
    if (!videoReady || !pageLoaded) return;
    const elapsed = performance.now() - start;
    setTimeout(hidePreloader, Math.max(0, MIN_DURATION - elapsed));
  }

  if (!videoReady) {
    video.addEventListener("loadeddata", () => {
      videoReady = true;
      maybeFinish();
    });
  }

  if (!pageLoaded) {
    window.addEventListener("load", () => {
      pageLoaded = true;
      maybeFinish();
    });
  }

  maybeFinish();
  setTimeout(hidePreloader, MAX_WAIT);
})();
