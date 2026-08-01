(() => {
  const trigger = document.getElementById("about-trigger");
  const aboutItem = document.querySelector(".menu-item--about");
  const yearEl = document.querySelector(".menu-item--year");
  const modal = document.getElementById("about-modal");
  const closeBtn = modal ? modal.querySelector(".about-modal__close") : null;
  const profilePic = document.getElementById("profile-pic");
  if (!trigger || !aboutItem || !yearEl || !modal || !closeBtn) return;

  // Anchored to the year label's actual rendered box (not the grid track
  // it sits in) because the hero row is vertically centered -- a
  // grid-based position would land at the top of the viewport, not at
  // "2026©" itself.
  function positionModal() {
    const rect = yearEl.getBoundingClientRect();
    // 2pt nudge up for optical alignment against the year label.
    modal.style.top = `calc(${rect.top}px - 2pt)`;
    modal.style.left = `${rect.left}px`;
  }

  // Must match the transform/opacity transition duration in style.css --
  // a CSS transition can't run across a display:none boundary, so [hidden]
  // is only applied once the closing animation has actually finished.
  const PROFILE_PIC_TRANSITION_MS = 200;
  let profilePicHideTimer = null;

  function showProfilePic() {
    if (!profilePic) return;
    if (profilePicHideTimer !== null) {
      clearTimeout(profilePicHideTimer);
      profilePicHideTimer = null;
    }
    profilePic.hidden = false;
    // Forces the "still scaled down" state to actually paint before
    // adding the class, otherwise the browser can coalesce both changes
    // into one frame and skip the transition entirely.
    requestAnimationFrame(() => {
      profilePic.classList.add("is-visible");
    });
  }

  function hideProfilePic() {
    if (!profilePic) return;
    profilePic.classList.remove("is-visible");
    profilePicHideTimer = setTimeout(() => {
      profilePic.hidden = true;
      profilePicHideTimer = null;
    }, PROFILE_PIC_TRANSITION_MS);
  }

  function openModal() {
    positionModal();
    modal.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    aboutItem.classList.add("about-active");
    showProfilePic();
  }

  function closeModal() {
    modal.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    aboutItem.classList.remove("about-active");
    hideProfilePic();
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
})();
