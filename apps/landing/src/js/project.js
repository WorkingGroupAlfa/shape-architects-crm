(async function () {
  const data = await loadSiteData();
  const params = new URLSearchParams(window.location.search);
  const project = data.portfolio.find((item) => item.slug === params.get("slug")) || data.portfolio[0];

  document.title = `${project.title} - Shape Architects`;
  document.querySelector("[data-project-title]").textContent = project.title.replace(", Port Adelaide", "");
  document.querySelector("[data-project-main-image]").src = assetUrl(project.image);

  const description = document.querySelector("[data-project-description]");
  description.innerHTML = `
    <p>${project.description || ""}</p>
    ${project.body ? `<p>${project.body}</p>` : ""}
    ${project.developer ? `<p>Developer: ${project.developer}</p>` : ""}
    ${project.designArchitect ? `<p>Design Architect: ${project.designArchitect}</p>` : ""}
    ${project.localDeliveryArchitect ? `<p>Local Delivery Architect: ${project.localDeliveryArchitect}</p>` : ""}
    ${project.builder ? `<p>Builder: ${project.builder}</p>` : ""}
  `;

  const infoItems = [
    ["Type", project.type],
    ["Construction Dates", project.constructionDates],
    ["Location", project.location],
    ["Dwellings", project.dwellings],
    ["Our Services", project.services],
  ];

  const info = document.querySelector("[data-project-info]");
  info.innerHTML = infoItems
    .map(
      ([title, value], index) => `<article class="project-info-item ${index === 0 ? "is-open" : ""}">
        <button type="button" aria-expanded="${index === 0 ? "true" : "false"}">${title}</button>
        <div class="project-info-answer" aria-hidden="${index === 0 ? "false" : "true"}">
          <div>${value || "More to come!"}</div>
        </div>
      </article>`
    )
    .join("");

  info.querySelectorAll(".project-info-item").forEach((item) => {
    const answer = item.querySelector(".project-info-answer");
    answer.style.maxHeight = item.classList.contains("is-open") ? `${answer.scrollHeight}px` : "0px";
    item.querySelector("button").addEventListener("click", () => {
      const open = item.classList.toggle("is-open");
      item.querySelector("button").setAttribute("aria-expanded", String(open));
      answer.setAttribute("aria-hidden", String(!open));
      answer.style.maxHeight = open ? `${answer.scrollHeight}px` : "0px";
    });
  });

  const galleryImages = project.gallery || [project.image];
  document.querySelector("[data-project-gallery]").innerHTML = galleryImages
    .map((image, index) => `<img src="${assetUrl(image)}" alt="" data-gallery-image data-index="${index}" />`)
    .join("");

  document.querySelectorAll("[data-gallery-image]").forEach((image) => {
    image.addEventListener("load", () => {
      const portrait = image.naturalHeight > image.naturalWidth * 1.08;
      const landscape = image.naturalWidth > image.naturalHeight * 1.28;
      image.classList.toggle("is-portrait", portrait);
      image.classList.toggle("is-landscape", landscape);
    });
  });

  const outcome = document.querySelector("[data-project-outcome]");
  if (outcome) outcome.textContent = project.outcome || "More to come!";

  const menuToggle = document.querySelector("[data-menu-toggle]");
  const mobileMenu = document.querySelector("[data-mobile-menu]");
  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener("click", () => {
      const open = mobileMenu.classList.toggle("open");
      menuToggle.setAttribute("aria-expanded", String(open));
    });
    mobileMenu.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        mobileMenu.classList.remove("open");
        menuToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  const backTop = document.querySelector("[data-back-top]");
  const toggleBackTop = () => {
    backTop.classList.toggle("is-visible", window.scrollY > 420);
  };
  backTop.addEventListener("click", (event) => {
    event.preventDefault();
    backTop.classList.add("is-scrolling");
    window.scrollTo({ top: 0, behavior: "smooth" });
    const checkDone = () => {
      if (window.scrollY <= 0) {
        backTop.classList.remove("is-scrolling");
      } else {
        requestAnimationFrame(checkDone);
      }
    };
    requestAnimationFrame(checkDone);
  });
  window.addEventListener("scroll", toggleBackTop, { passive: true });
  toggleBackTop();
})();

async function loadSiteData() {
  try {
    const response = await fetch(`${apiBase()}/public/website`, { cache: "no-store" });
    if (!response.ok) throw new Error("Website content unavailable");
    return response.json();
  } catch {
    return window.SHAPE_SITE_DATA;
  }
}

function apiBase() {
  const configured = import.meta.env.VITE_API_URL;
  const fallback = location.hostname === "localhost" || location.hostname === "127.0.0.1"
    ? "http://localhost:4311/api"
    : "https://shape-architects-crm-api.onrender.com/api";
  return (window.SHAPE_API_URL || configured || fallback).replace(/\/+$/, "");
}

function assetUrl(value) {
  if (!value) return "";
  if (value.startsWith("http")) return value;
  if (value.startsWith("/storage")) return `${apiBase().replace(/\/api$/, "")}${value}`;
  return value;
}
