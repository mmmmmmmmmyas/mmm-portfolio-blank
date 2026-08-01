(() => {
  const leftMenu = document.querySelector(".menu:not(.menu--right)");
  const rightMenu = document.querySelector(".menu--right");
  const chipItem = document.querySelector(".menu-item--chips");
  const availabilityLabel = document.querySelector(".menu-item--availability");
  const chips = document.querySelectorAll(".chip");
  if (!leftMenu || !rightMenu || !chipItem || !availabilityLabel) return;

  // All chips share one fixed width (whichever label is naturally widest --
  // "SEPT." -- rather than each hugging its own text). Measured, not
  // hardcoded, since it depends on which font is currently rendering.
  function sizeChips() {
    if (!chips.length) return;
    chips.forEach((c) => { c.style.width = ""; });
    const maxWidth = Math.max(...Array.from(chips, (c) => c.getBoundingClientRect().width));
    chips.forEach((c) => { c.style.width = `${maxWidth}px`; });
  }

  const desktopQuery = window.matchMedia("(min-width: 1025px)");

  // A text element's own box top sits above the actual glyph ink -- the
  // line-height leading gap -- so aligning boxes isn't enough for optical
  // alignment. Range.getBoundingClientRect() on the text node itself gives
  // the real ink-tight box, unlike the element's own (line-box) rect.
  function measureGlyphInsetTop(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const textNode = walker.nextNode();
    if (!textNode) return 0;
    const range = document.createRange();
    range.selectNodeContents(textNode);
    return range.getBoundingClientRect().top - el.getBoundingClientRect().top;
  }

  // .menu--right is taller than .menu (the services label wraps to several
  // lines), so it can't share .menu's align-self:center -- that would
  // center each by its own box height and leave their tops mismatched.
  // Instead it's align-self:start, top-flush with .menu (see below), then
  // nudged with margin-top to close the remaining gap. Recomputed on
  // load/resize since it depends on the globe's rendered height, which is
  // viewport-relative.
  //
  // The chips' text is centered inside a fixed-height pill, so the pill's
  // own box top is a purely geometric edge (independent of its text's
  // baseline) -- it already lands exactly on .menu's glyph top once the
  // boxes are flush. The plain text labels don't: their glyph ink starts
  // `glyphInset` below their own box top. Fix: pad the chip item down by
  // that same amount (so it moves off the now-shared box-top reference),
  // then shift the whole menu up by `glyphInset` (so the text labels' ink
  // -- not their box tops -- lands on target). Net movement: text labels
  // move up by glyphInset, the chip row stays exactly where it already was.
  function alignRightMenu() {
    sizeChips();

    if (!desktopQuery.matches) {
      rightMenu.style.marginTop = "";
      chipItem.style.paddingTop = "";
      return;
    }

    chipItem.style.paddingTop = "0px";
    const glyphInset = measureGlyphInsetTop(availabilityLabel);
    chipItem.style.paddingTop = `${glyphInset}px`;

    rightMenu.style.marginTop = "0px";
    const delta = leftMenu.getBoundingClientRect().top - rightMenu.getBoundingClientRect().top;
    rightMenu.style.marginTop = `${delta - glyphInset}px`;
  }

  window.addEventListener("load", alignRightMenu);
  window.addEventListener("resize", alignRightMenu);
  desktopQuery.addEventListener("change", alignRightMenu);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(alignRightMenu);
  }
  alignRightMenu();
})();
