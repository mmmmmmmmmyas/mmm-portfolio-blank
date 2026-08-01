(() => {
  const trigger = document.getElementById("inquiry-trigger");
  const availabilityLabel = document.querySelector(".menu-item--availability");
  const yearLabel = document.querySelector(".menu-item--year");
  const modal = document.getElementById("inquiry-modal");
  const closeBtn = modal ? modal.querySelector(".inquiry-modal__close") : null;
  if (!trigger || !availabilityLabel || !yearLabel || !modal || !closeBtn) return;

  const desktopQuery = window.matchMedia("(min-width: 1025px)");

  // Desktop: anchored to "AVAILABLE FOR PROJECTS:"'s own rendered box (not
  // the grid track) for the same reason about-modal.js anchors to the year
  // label -- the hero row is vertically centered, so a grid-based position
  // would land at the top of the viewport, not at the label itself.
  // Expands rightward from there, covering the rest of the right menu.
  //
  // Mobile: everything stacks in one column, so "left of/covering the
  // right menu" doesn't apply -- it opens in the exact same spot as
  // about-modal instead (anchored to the year label, same -2pt nudge).
  function positionModal() {
    if (desktopQuery.matches) {
      const rect = availabilityLabel.getBoundingClientRect();
      modal.style.top = `${rect.top}px`;
      modal.style.left = `${rect.left}px`;
    } else {
      const rect = yearLabel.getBoundingClientRect();
      modal.style.top = `calc(${rect.top}px - 2pt)`;
      modal.style.left = `${rect.left}px`;
    }
  }

  function openModal() {
    positionModal();
    modal.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  }

  function closeModal() {
    modal.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  trigger.addEventListener("click", () => {
    if (modal.hidden) {
      openModal();
    } else {
      closeModal();
    }
  });

  closeBtn.addEventListener("click", closeModal);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.hidden) closeModal();
  });

  window.addEventListener("resize", () => {
    if (!modal.hidden) positionModal();
  });

  desktopQuery.addEventListener("change", () => {
    if (!modal.hidden) positionModal();
  });
})();
