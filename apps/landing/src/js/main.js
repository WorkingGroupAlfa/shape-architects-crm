(async function () {
  const data = await loadSiteData();

  const pillars = document.querySelector("[data-pillars]");
  pillars.innerHTML = data.pillars
    .map((item) => `<article class="pillar"><img class="pillar-icon" src="${assetUrl(item.icon)}" alt="" /><h3>${item.title}</h3><p>${item.text}</p></article>`)
    .join("");

  const team = document.querySelector("[data-team]");
  team.innerHTML = data.team
    .map(
      (person) => `<article class="person"><img src="${assetUrl(person.image)}" alt="${person.name}" /><p class="role">${person.role}</p><h3>${person.name}</h3><p>${person.bio}</p></article>`
    )
    .join("");

  const portfolio = document.querySelector("[data-portfolio]");
  const portfolioItems = [...data.portfolio, ...data.portfolio, ...data.portfolio];
  portfolio.innerHTML = portfolioItems
    .map(
      (project) => `<a class="project" href="project.html?slug=${project.slug}"><img src="${assetUrl(project.image)}" alt="${project.title}" /><div class="project-meta"><h3>${project.title}</h3><span>${project.year}</span></div></a>`
    )
    .join("");

  const getPortfolioLoopSize = () => portfolio.scrollWidth / 3;
  const setInitialPortfolioPosition = () => {
    portfolio.scrollLeft = getPortfolioLoopSize();
  };
  const normalizePortfolioPosition = () => {
    const loopSize = getPortfolioLoopSize();
    if (!loopSize) return;
    if (portfolio.scrollLeft < loopSize * 0.5) {
      portfolio.scrollLeft += loopSize;
    } else if (portfolio.scrollLeft > loopSize * 1.5) {
      portfolio.scrollLeft -= loopSize;
    }
  };
  const scrollPortfolio = (direction) => {
    const card = portfolio.querySelector(".project");
    const gap = parseFloat(getComputedStyle(portfolio).gap) || 40;
    const distance = card ? card.getBoundingClientRect().width + gap : 440;
    portfolio.scrollBy({ left: direction * distance, behavior: "smooth" });
    window.setTimeout(normalizePortfolioPosition, 450);
  };

  requestAnimationFrame(setInitialPortfolioPosition);
  portfolio.addEventListener("scroll", () => {
    window.clearTimeout(portfolio._loopTimer);
    portfolio._loopTimer = window.setTimeout(normalizePortfolioPosition, 120);
  });
  window.addEventListener("resize", setInitialPortfolioPosition);

  const services = document.querySelector("[data-services]");
  const serviceColumns = [
    data.services.filter((_, index) => index % 2 === 0),
    data.services.filter((_, index) => index % 2 === 1),
  ];
  services.innerHTML = serviceColumns
    .map(
      (column) =>
        `<div class="service-column">${column
          .map(
            (service) => `<article class="service-item ${service.open ? "is-open" : ""}" data-service-item>
              <button class="service-question" type="button" aria-expanded="${service.open ? "true" : "false"}">${service.title}</button>
              <div class="service-answer" aria-hidden="${service.open ? "false" : "true"}">
                <div class="service-answer-inner">${service.content}</div>
              </div>
            </article>`
          )
          .join("")}</div>`
    )
    .join("");

  const closeServiceItem = (item) => {
    const button = item.querySelector(".service-question");
    const answer = item.querySelector(".service-answer");
    item.classList.remove("is-open");
    button.setAttribute("aria-expanded", "false");
    answer.setAttribute("aria-hidden", "true");
    answer.style.maxHeight = "0px";
  };

  const openServiceItem = (item) => {
    const button = item.querySelector(".service-question");
    const answer = item.querySelector(".service-answer");
    item.classList.add("is-open");
    button.setAttribute("aria-expanded", "true");
    answer.setAttribute("aria-hidden", "false");
    answer.style.maxHeight = `${answer.scrollHeight}px`;
  };

  services.querySelectorAll("[data-service-item]").forEach((item) => {
    const answer = item.querySelector(".service-answer");
    answer.style.maxHeight = item.classList.contains("is-open") ? `${answer.scrollHeight}px` : "0px";
    item.querySelector(".service-question").addEventListener("click", () => {
      const column = item.closest(".service-column");
      const isOpen = item.classList.contains("is-open");
      column.querySelectorAll("[data-service-item].is-open").forEach(closeServiceItem);
      if (!isOpen) openServiceItem(item);
    });
  });

  document.querySelector("[data-scroll-left]").addEventListener("click", () => {
    scrollPortfolio(-1);
  });

  document.querySelector("[data-scroll-right]").addEventListener("click", () => {
    scrollPortfolio(1);
  });

  const menuToggle = document.querySelector("[data-menu-toggle]");
  const mobileMenu = document.querySelector("[data-mobile-menu]");
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

  const backTop = document.querySelector("[data-back-top]");
  const hero = document.querySelector(".hero");
  const toggleBackTop = () => {
    backTop.classList.toggle("is-visible", window.scrollY > hero.offsetHeight - 120);
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
  window.addEventListener("resize", toggleBackTop);
  toggleBackTop();

  const contactForm = document.querySelector("[data-contact-form]");
  const formStatus = document.querySelector("[data-form-status]");
  contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(contactForm).entries());
    formStatus.textContent = "Sending...";
    try {
      const response = await fetch(`${apiBase()}/public/leads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error("Request failed");
      contactForm.reset();
      formStatus.textContent = "Thank you. We will contact you soon.";
    } catch {
      formStatus.textContent = "Could not send the request. Please email us directly.";
    }
  });
})();

async function loadSiteData() {
  try {
    const response = await fetch(`${apiBase()}/public/website`, { cache: "no-store" });
    if (!response.ok) throw new Error("Website content unavailable");
    const data = await response.json();
    hydrateStaticText(data);
    return data;
  } catch {
    const fallback = window.SHAPE_SITE_DATA;
    hydrateStaticText(fallback);
    return fallback;
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

function hydrateStaticText(data) {
  const home = data.home || {};
  const meta = data.meta || {};
  setText("[data-edit='hero.title']", home.heroTitle);
  setText("[data-edit='hero.subtitle']", home.heroSubtitle);
  setText("[data-edit='about.kicker']", home.aboutKicker);
  setText("[data-edit='about.statement']", home.aboutStatement);
  setText("[data-edit='team.title']", home.teamTitle);
  setText("[data-edit='team.copy']", home.teamCopy);
  setText("[data-edit='work.statement']", home.workStatement);
  setText("[data-edit='services.title']", home.servicesTitle);
  setText("[data-edit='services.copy']", home.servicesCopy);
  setText("[data-edit='contact.title']", home.contactTitle);
  setText("[data-edit='contact.copy']", home.contactCopy);
  setText("[data-footer-copy]", meta.footerCopy);
  setText("[data-copyright]", meta.copyright);
  setText("[data-address]", meta.address);
  setText("[data-email]", meta.email);
  setHref("[data-email-link]", meta.email ? `mailto:${meta.email}` : "");
}

function setText(selector, value) {
  const node = document.querySelector(selector);
  if (node && value) node.textContent = value;
}

function setHref(selector, value) {
  document.querySelectorAll(selector).forEach((node) => {
    if (value) node.href = value;
  });
}
