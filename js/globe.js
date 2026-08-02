(() => {
  const wrap = document.querySelector(".sphere-wrap");
  const canvas = document.getElementById("globe");
  if (!wrap || !canvas) return;

  // desynchronized: true lets the browser skip some compositing sync on
  // devices that support it (most mobile browsers) -- lower input latency
  // and one less thing serializing this canvas's paints against the rest
  // of the page. Falls back to being silently ignored where unsupported.
  const ctx = canvas.getContext("2d", { desynchronized: true });

  // Touch/mobile devices are typically both weaker (CPU/GPU) and higher
  // DPR (so every pixel costs more) than the desktop machines this was
  // built against -- coarser geometry here is what keeps drag interaction
  // and decal playback smooth on them, not a visual downgrade anyone is
  // meant to consciously notice at this scale.
  const isCoarsePointer = window.matchMedia("(pointer: coarse)").matches;

  const LAT_STEP = 30; // deg, parallels
  const LON_STEP = 30; // deg, meridians
  const SEGMENTS = isCoarsePointer ? 24 : 48; // points per line
  const PERSPECTIVE = 3; // camera distance factor, in radii

  // The centroid sits on the sphere itself, at the point that faces
  // the screen when yaw/pitch are both 0. The logo decal is wrapped
  // onto the sphere surface centered on this same point.
  const centroid = { x: 0, y: 0, z: 1 };

  // Angular half-width of the logo decal patch, and how finely it's
  // subdivided into triangles for the curvature warp (higher = smoother
  // curve, more draw calls).
  const DECAL_HALF_ANGLE = (31.68 * Math.PI) / 180; // 22 * 1.2 * 1.2
  // Each grid cell costs 2 full triangle warps (save/clip/transform/
  // drawImage/restore on the video element) -- by far the most expensive
  // part of a frame. 8x8 is 128 of those; halving the grid to 4x4 cuts it
  // to 32, which is what actually keeps the decal's playback smooth
  // instead of stuttering once mobile GPUs can't keep up with 60fps.
  const DECAL_GRID = isCoarsePointer ? 4 : 8;

  // Texture source for the decal is a <video>, not the hero's <img> GIF --
  // canvas drawImage() doesn't reliably keep advancing an animated GIF's
  // frame no matter how the <img> is attached/played, but a <video>'s
  // playback clock runs independently and drawImage always reflects
  // whatever frame it's actually showing. It's encoded with a plain black
  // background (no alpha -- that turned out to be too unreliable across
  // encoders/browsers to depend on); drawn with a "lighten" blend below,
  // black contributes nothing so the wireframe still shows through.
  const logoVideo = document.querySelector(".logo-video");
  let logoReady = false;
  if (logoVideo) {
    if (logoVideo.readyState >= 2) {
      logoReady = true;
    } else {
      logoVideo.addEventListener("loadeddata", () => {
        logoReady = true;
      });
    }
    // Autoplay can still be blocked by browser policy even when muted;
    // this is a harmless no-op retry if it's already playing.
    logoVideo.play().catch(() => {});
  }

  // Precompute the decal's local (unrotated) grid: each vertex is a
  // point on the unit sphere reached by tilting the pole (0,0,1) by two
  // independent angles (au, av) -- the same two-axis-tilt construction
  // used for yaw/pitch -- paired with where that vertex sits in the
  // source image's pixel space. Doesn't depend on rotation, so it's
  // built once.
  const decalGrid = [];
  for (let j = 0; j <= DECAL_GRID; j++) {
    const row = [];
    const av = ((j / DECAL_GRID) * 2 - 1) * DECAL_HALF_ANGLE;
    for (let i = 0; i <= DECAL_GRID; i++) {
      const au = ((i / DECAL_GRID) * 2 - 1) * DECAL_HALF_ANGLE;
      const sinAu = Math.sin(au), cosAu = Math.cos(au);
      const sinAv = Math.sin(av), cosAv = Math.cos(av);
      row.push({
        x: sinAu,
        y: -cosAu * sinAv,
        z: cosAu * cosAv,
        u: i / DECAL_GRID,
        v: j / DECAL_GRID,
      });
    }
    decalGrid.push(row);
  }

  const parallels = [];
  for (let lat = -60; lat <= 60; lat += LAT_STEP) {
    const phi = (lat * Math.PI) / 180;
    const pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const theta = (i / SEGMENTS) * Math.PI * 2;
      pts.push({
        x: Math.cos(phi) * Math.cos(theta),
        y: Math.sin(phi),
        z: Math.cos(phi) * Math.sin(theta),
      });
    }
    parallels.push(pts);
  }

  const meridians = [];
  for (let lon = 0; lon < 180; lon += LON_STEP) {
    const theta = (lon * Math.PI) / 180;
    const pts = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const phi = (i / SEGMENTS) * Math.PI * 2;
      pts.push({
        x: Math.cos(phi) * Math.cos(theta),
        y: Math.sin(phi),
        z: Math.cos(phi) * Math.sin(theta),
      });
    }
    meridians.push(pts);
  }

  let yaw = 0;
  let pitch = 0;
  let dpr = 1;
  let size = 0; // CSS px, square

  function rotate(p) {
    // yaw around the vertical axis, then pitch around the horizontal axis
    const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
    const x1 = p.x * cosY + p.z * sinY;
    const z1 = -p.x * sinY + p.z * cosY;
    const y1 = p.y;

    const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
    const y2 = y1 * cosP - z1 * sinP;
    const z2 = y1 * sinP + z1 * cosP;
    return { x: x1, y: y2, z: z2 };
  }

  function project(p, radiusPx, cx, cy) {
    const scale = PERSPECTIVE / (PERSPECTIVE - p.z);
    return {
      x: cx + p.x * radiusPx * scale,
      y: cy - p.y * radiusPx * scale,
      z: p.z,
    };
  }

  // Each segment's alpha fakes depth shading (nearer = very slightly
  // brighter), which used to mean a separate beginPath/moveTo/lineTo/
  // stroke for every single one of the 48 segments in a line -- ~500
  // individual stroke() calls per frame across all parallels+meridians,
  // each carrying its own fixed call overhead regardless of how short the
  // segment actually is. Segments are batched into a handful of alpha
  // bins instead (rounded to the nearest 1/400th) and each bin is stroked
  // once via Path2D -- same depth-shaded look at a fraction of the calls,
  // since the whole gradient only spans ~4 perceptibly different steps
  // anyway (it's capped at 1% opacity to begin with).
  function drawLine(points, radiusPx, cx, cy) {
    const bins = new Map();
    for (let i = 0; i < points.length - 1; i++) {
      const a = rotate(points[i]);
      const b = rotate(points[i + 1]);
      const pa = project(a, radiusPx, cx, cy);
      const pb = project(b, radiusPx, cx, cy);
      const zAvg = (a.z + b.z) / 2;
      const alpha = 0.0016 + 0.0084 * ((zAvg + 1) / 2); // capped at 1% opacity
      const bin = Math.round(alpha * 400);
      let path = bins.get(bin);
      if (!path) {
        path = new Path2D();
        bins.set(bin, path);
      }
      path.moveTo(pa.x, pa.y);
      path.lineTo(pb.x, pb.y);
    }
    for (const [bin, path] of bins) {
      ctx.strokeStyle = `rgba(255,255,255,${bin / 400})`;
      ctx.stroke(path);
    }
  }

  // Canvas 2D has no native texture mapping, so a triangle is warped by
  // solving the affine transform that carries its 3 source (image-pixel)
  // points onto its 3 destination (screen) points, then clipping to the
  // destination triangle and drawing the image through that transform.
  // Splitting the decal into many small triangles is what makes the
  // overall patch read as curved instead of a flat warped quad.
  function drawTexturedTriangle(img, d0, d1, d2, s0, s1, s2) {
    const denom = s0.u * (s1.v - s2.v) + s1.u * (s2.v - s0.v) + s2.u * (s0.v - s1.v);
    if (Math.abs(denom) < 1e-9) return;

    const a = (d0.x * (s1.v - s2.v) + d1.x * (s2.v - s0.v) + d2.x * (s0.v - s1.v)) / denom;
    const b = (d0.y * (s1.v - s2.v) + d1.y * (s2.v - s0.v) + d2.y * (s0.v - s1.v)) / denom;
    const c = (d0.x * (s2.u - s1.u) + d1.x * (s0.u - s2.u) + d2.x * (s1.u - s0.u)) / denom;
    const d = (d0.y * (s2.u - s1.u) + d1.y * (s0.u - s2.u) + d2.y * (s1.u - s0.u)) / denom;
    const e = (d0.x * (s1.u * s2.v - s2.u * s1.v) + d1.x * (s2.u * s0.v - s0.u * s2.v) + d2.x * (s0.u * s1.v - s1.u * s0.v)) / denom;
    const f = (d0.y * (s1.u * s2.v - s2.u * s1.v) + d1.y * (s2.u * s0.v - s0.u * s2.v) + d2.y * (s0.u * s1.v - s1.u * s0.v)) / denom;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(d0.x, d0.y);
    ctx.lineTo(d1.x, d1.y);
    ctx.lineTo(d2.x, d2.y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(a, b, c, d, e, f);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  function drawDecal(radiusPx, cx, cy) {
    if (!logoReady) return;

    const c = rotate(centroid);
    if (c.z <= -0.1) return; // facing away, nothing to show

    const w = logoVideo.videoWidth;
    const h = logoVideo.videoHeight;

    // Rotate + project every grid vertex once per frame, and stash the
    // image-pixel coords alongside so triangles below can reuse both.
    const projected = decalGrid.map((row) =>
      row.map((p) => {
        const r = rotate(p);
        const s = project(r, radiusPx, cx, cy);
        return { x: s.x, y: s.y, z: r.z, u: p.u * w, v: p.v * h };
      })
    );

    // "lighten" instead of relying on alpha: the video's background is
    // solid black, and lighten leaves the destination (the wireframe)
    // untouched wherever the source is black, only actually painting the
    // white letter -- same visual result as a transparent background.
    ctx.globalCompositeOperation = "lighten";

    for (let j = 0; j < DECAL_GRID; j++) {
      for (let i = 0; i < DECAL_GRID; i++) {
        const p00 = projected[j][i];
        const p10 = projected[j][i + 1];
        const p01 = projected[j + 1][i];
        const p11 = projected[j + 1][i + 1];
        // skip triangles that dip behind the visible hemisphere
        if (p00.z <= -0.1 || p10.z <= -0.1 || p01.z <= -0.1) continue;
        drawTexturedTriangle(logoVideo, p00, p10, p01, p00, p10, p01);
        if (p10.z <= -0.1 || p11.z <= -0.1 || p01.z <= -0.1) continue;
        drawTexturedTriangle(logoVideo, p10, p11, p01, p10, p11, p01);
      }
    }

    ctx.globalCompositeOperation = "source-over";
  }

  function draw() {
    ctx.clearRect(0, 0, size, size);

    const cx = size / 2;
    const cy = size / 2;
    const radiusPx = size * 0.46;

    ctx.lineWidth = 1;

    for (const line of parallels) drawLine(line, radiusPx, cx, cy);
    for (const line of meridians) drawLine(line, radiusPx, cx, cy);

    ctx.beginPath();
    ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(255,255,255,0.01)";
    ctx.stroke();

    drawDecal(radiusPx, cx, cy);
  }

  function resize() {
    // Capped at 2x -- going to a phone's native 3x devicePixelRatio would
    // triple the pixel fill cost of every stroke/drawImage call for a
    // sharpness difference nobody perceives on a wireframe this faint.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = wrap.clientWidth;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  const RETURN_DELAY = 500; // ms of no movement before it drifts back
  const EASE_DURATION = 600; // ms for the eased transition, both in and out

  // Elliptical limit: yaw (horizontal) and pitch (vertical) each get
  // their own cap. The centroid can't be rotated past either, in its
  // own direction. Resistance ramps up continuously as it's approached
  // (rubber-band), so it's never a hard stop.
  const YAW_LIMIT = (45 * Math.PI) / 180;
  const PITCH_LIMIT = (30 * Math.PI) / 180;
  // The "reverse" deadzone: unlike a normal deadzone (dead near where you
  // enter), this one is dead everywhere EXCEPT within this margin outside
  // the globe's visible edge -- the interaction is live inside the globe
  // and in a ring this wide around it, and inert everywhere past that.
  // Sized relative to the globe itself (0.45x its own width/diameter) rather
  // than a fixed px value, so it scales with however big the globe renders.
  const REVERSE_DEADZONE_WIDTHS = 0.45;
  // How fast the response falls off as the centroid nears LIMIT. This is
  // the whole effect: velocity is proportional to remaining distance to
  // the cap (classic exponential approach -- like braking proportional
  // to distance from a wall), so the slowdown is felt continuously
  // throughout the drag, not just in a thin zone right at the edge.
  const RUBBER_STIFFNESS = 1.2;

  // Unbounded accumulators driving the rubber-band function below.
  // yaw/pitch (the actual rendered rotation) are always a squashed
  // projection of these, so they can approach LIMIT but never reach it.
  let yawRaw = 0;
  let pitchRaw = 0;

  let returnTimer = null;
  // Where yaw/pitch are headed. Continuously updated by pointermove while
  // engaged (or pinned to 0,0 while returning); the render loop is what
  // actually moves yaw/pitch toward it, easing or snapping as below.
  let targetYaw = 0;
  let targetPitch = 0;
  // { fromYaw, fromPitch, start } while easing, else null. Started once on
  // an engage/disengage transition and left to chase whatever `target`
  // currently is -- so it isn't torn down by every subsequent pointermove
  // during the same continuous entry gesture.
  let tween = null;

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  // f(x) = L * (1 - e^(-s*x/L)). Solves df/dx = s * (1 - f/L): the
  // response speed drops in direct proportion to how close f already is
  // to the limit -- at the halfway point it's moving at half speed, at
  // 90% of the way there it's down to 10% speed, and so on. Never
  // reaches L, but the deceleration is felt the whole way, not just at
  // the very end.
  function rubberBand(x, limit, stiffness) {
    return limit * (1 - Math.exp((-stiffness * x) / limit));
  }

  // Normalizes yaw/pitch by their own limits first, so the combined
  // magnitude is 1.0 exactly at the ellipse boundary regardless of
  // direction, then applies the same 1-D rubber band in that normalized
  // space (limit=1) before scaling each axis back out by its own limit.
  // Returns the target rather than mutating yaw/pitch directly, since the
  // caller may want to ease toward it instead of snapping to it.
  function computeTarget(yawRawVal, pitchRawVal) {
    const nx = yawRawVal / YAW_LIMIT;
    const ny = pitchRawVal / PITCH_LIMIT;
    const rawMag = Math.hypot(nx, ny);
    if (rawMag === 0) return { yaw: 0, pitch: 0 };
    const displayedMag = rubberBand(rawMag, 1, RUBBER_STIFFNESS);
    const factor = displayedMag / rawMag;
    return { yaw: nx * factor * YAW_LIMIT, pitch: ny * factor * PITCH_LIMIT };
  }

  function startTween() {
    tween = { fromYaw: yaw, fromPitch: pitch, start: performance.now() };
  }

  function clearReturnTimer() {
    if (returnTimer !== null) {
      clearTimeout(returnTimer);
      returnTimer = null;
    }
  }

  function scheduleReturn() {
    clearReturnTimer();
    returnTimer = setTimeout(startReturn, RETURN_DELAY);
  }

  function startReturn() {
    returnTimer = null;
    targetYaw = 0;
    targetPitch = 0;
    yawRaw = 0;
    pitchRaw = 0;
    startTween();
  }

  // Runs continuously (not just while dragging/returning) so the GIF
  // decal's current frame keeps getting picked up every tick -- an
  // event-driven redraw would otherwise freeze it between interactions.
  // draw() is wrapped so one bad frame (a stray NaN, a layout edge case)
  // can never kill the requestAnimationFrame chain and silently freeze
  // the decal for good -- it just skips that frame and keeps going.
  function renderLoop(now) {
    if (tween !== null) {
      const t = Math.min(1, (now - tween.start) / EASE_DURATION);
      const e = easeOutCubic(t);
      // Reads target fresh each frame, not a value captured at tween
      // start, so continued cursor movement mid-ease smoothly redirects
      // it instead of the tween finishing toward a stale destination.
      yaw = tween.fromYaw + (targetYaw - tween.fromYaw) * e;
      pitch = tween.fromPitch + (targetPitch - tween.fromPitch) * e;
      if (t >= 1) tween = null;
    } else {
      yaw = targetYaw;
      pitch = targetPitch;
    }
    try {
      draw();
    } catch (err) {
      console.error("globe render error", err);
    }
    requestAnimationFrame(renderLoop);
  }

  // Listens globally (not just on the canvas) since the reverse deadzone
  // extends the live area beyond the canvas's own edges.
  let engaged = false;

  // passive: true -- this handler never calls preventDefault, so marking
  // it explicitly lets the browser keep touch scrolling elsewhere on the
  // page off this thread instead of blocking on it.
  window.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const radiusPx = rect.width * 0.46; // matches the drawn circle in draw()
    if (radiusPx <= 0) return; // not laid out yet -- would divide into NaN below
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = e.clientX - centerX;
    const dy = e.clientY - centerY;
    const reverseDeadzonePx = REVERSE_DEADZONE_WIDTHS * (radiusPx * 2);
    const withinRange = Math.hypot(dx, dy) <= radiusPx + reverseDeadzonePx;

    if (withinRange) {
      clearReturnTimer();
      // Absolute, not accumulated: the centroid tracks wherever the
      // cursor currently is, normalized by the globe's own on-screen
      // radius so it behaves the same regardless of rendered size.
      yawRaw = (dx / radiusPx) * YAW_LIMIT;
      pitchRaw = (dy / radiusPx) * PITCH_LIMIT;
      const target = computeTarget(yawRaw, pitchRaw);
      targetYaw = target.yaw;
      targetPitch = target.pitch;

      // Only kicks off on the transition into range -- subsequent moves
      // during the same gesture just update the target above and let the
      // render loop keep chasing it, rather than restarting or cancelling
      // the ease every time the cursor so much as twitches.
      if (!engaged) {
        engaged = true;
        startTween();
      }
    } else if (engaged) {
      engaged = false;
      scheduleReturn();
    }
  }, { passive: true });

  new ResizeObserver(resize).observe(wrap);
  resize();
  requestAnimationFrame(renderLoop);
})();
