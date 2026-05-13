const TOKEN_KEY = "shape_website_admin_token";

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  content: null,
  tab: "page",
  selectedProjectIndex: 0,
  status: "",
};

const app = document.querySelector("[data-admin-app]");

init();

async function init() {
  if (!state.token) {
    renderLogin();
    return;
  }

  try {
    state.content = await request("/public/website/admin/content");
    renderAdmin();
  } catch {
    localStorage.removeItem(TOKEN_KEY);
    state.token = "";
    renderLogin("Session expired. Please sign in again.");
  }
}

function renderLogin(error = "") {
  app.innerHTML = `
    <section class="site-admin-login">
      <form class="site-admin-login-card" data-login-form>
        <img src="/images/SHAPE+LOGO+VECTOR+-+White+(1).webp" alt="Shape Architects" />
        <p>Website editor</p>
        <input type="password" name="password" placeholder="Password" autocomplete="current-password" required />
        ${error ? `<div class="admin-error">${escapeHtml(error)}</div>` : ""}
        <button type="submit">Sign in</button>
      </form>
    </section>
  `;

  app.querySelector("[data-login-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const password = new FormData(event.currentTarget).get("password");
    try {
      const payload = await request("/public/website/admin/login", {
        method: "POST",
        body: JSON.stringify({ password }),
        skipAuth: true,
      });
      state.token = payload.token;
      localStorage.setItem(TOKEN_KEY, state.token);
      await init();
    } catch (loginError) {
      renderLogin(loginError.message || "Login failed");
    }
  });
}

function renderAdmin(options = {}) {
  const previousToolsScroll = options.preserveToolsScroll
    ? app.querySelector("[data-tools]")?.scrollTop ?? 0
    : 0;
  const tabs = [
    ["page", "Page"],
    ["works", "Our Works"],
    ["services", "Services"],
    ["team", "Team"],
    ["settings", "Settings"],
  ];

  app.innerHTML = `
    <section class="site-admin-shell">
      <aside class="site-admin-panel">
        <div class="site-admin-brand">
          <img src="/images/SHAPE+LOGO+VECTOR+-+White+(1).webp" alt="Shape Architects" />
          <button type="button" data-logout>Exit</button>
        </div>
        <nav class="site-admin-tabs">
          ${tabs.map(([key, label]) => `<button class="${state.tab === key ? "active" : ""}" type="button" data-tab="${key}">${label}</button>`).join("")}
        </nav>
        <div class="site-admin-tools" data-tools></div>
      </aside>
      <section class="site-admin-preview">
        <header>
          <div>
            <span>Live preview</span>
            <strong>Shape Architects</strong>
          </div>
          <div class="site-admin-actions">
            ${state.status ? `<small>${escapeHtml(state.status)}</small>` : ""}
            <a href="/" target="_blank" rel="noreferrer">Open site</a>
            <button type="button" data-save>Save</button>
          </div>
        </header>
        <iframe title="Shape Architects preview" src="/index.html" data-preview></iframe>
      </section>
    </section>
  `;

  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      renderAdmin();
    });
  });
  app.querySelector("[data-save]").addEventListener("click", saveContent);
  app.querySelector("[data-logout]").addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    state.token = "";
    state.content = null;
    renderLogin();
  });

  renderTools();
  if (options.preserveToolsScroll) {
    const tools = app.querySelector("[data-tools]");
    if (tools) requestAnimationFrame(() => { tools.scrollTop = previousToolsScroll; });
  }
}

function renderTools() {
  const tools = app.querySelector("[data-tools]");
  if (state.tab === "page") renderPageTools(tools);
  if (state.tab === "works") renderWorksTools(tools);
  if (state.tab === "services") renderRepeaterTools(tools, "services", ["title", "content"], { title: "New service", content: "" });
  if (state.tab === "team") renderRepeaterTools(tools, "team", ["name", "role", "image", "bio"], { name: "New member", role: "", image: "", bio: "" });
  if (state.tab === "settings") renderSettingsTools(tools);
}

function renderPageTools(tools) {
  const home = state.content.home;
  tools.innerHTML = `
    ${field("Hero title", "home.heroTitle", home.heroTitle)}
    ${area("Hero subtitle", "home.heroSubtitle", home.heroSubtitle)}
    ${field("About kicker", "home.aboutKicker", home.aboutKicker)}
    ${area("About statement", "home.aboutStatement", home.aboutStatement)}
    ${field("Team title", "home.teamTitle", home.teamTitle)}
    ${area("Team copy", "home.teamCopy", home.teamCopy)}
    ${area("Our Work statement", "home.workStatement", home.workStatement)}
    ${field("Services title", "home.servicesTitle", home.servicesTitle)}
    ${area("Services copy", "home.servicesCopy", home.servicesCopy)}
    ${field("Contact title", "home.contactTitle", home.contactTitle)}
    ${area("Contact copy", "home.contactCopy", home.contactCopy)}
  `;
  bindInputs();
}

function renderWorksTools(tools) {
  const projects = state.content.portfolio;
  const project = projects[state.selectedProjectIndex] || projects[0];
  if (!project) return;

  tools.innerHTML = `
    <button class="admin-add-btn" type="button" data-add-project>+ Add project</button>
    <div class="admin-project-list">
      ${projects.map((item, index) => `
        <button class="${index === state.selectedProjectIndex ? "active" : ""}" type="button" data-project="${index}">
          <span>${escapeHtml(item.title)}</span>
          <small>${item.published === false ? "Hidden" : escapeHtml(item.year || "")}</small>
        </button>
      `).join("")}
    </div>
    <div class="admin-tool-divider"></div>
    <label class="admin-check"><input type="checkbox" data-project-published ${project.published === false ? "" : "checked"} /> Published</label>
    ${field("Title", "project.title", project.title)}
    ${field("Slug", "project.slug", project.slug)}
    ${field("Year", "project.year", project.year)}
    ${area("Description", "project.description", project.description)}
    ${area("Body", "project.body", project.body || "")}
    ${field("Developer", "project.developer", project.developer || "")}
    ${field("Design architect", "project.designArchitect", project.designArchitect || "")}
    ${field("Local delivery architect", "project.localDeliveryArchitect", project.localDeliveryArchitect || "")}
    ${field("Builder", "project.builder", project.builder || "")}
    ${field("Type", "project.type", project.type || "")}
    ${field("Construction dates", "project.constructionDates", project.constructionDates || "")}
    ${field("Location", "project.location", project.location || "")}
    ${field("Dwellings", "project.dwellings", project.dwellings || "")}
    ${area("Services", "project.services", project.services || "")}
    ${area("Approach", "project.approach", project.approach || "")}
    ${area("Outcome", "project.outcome", project.outcome || "")}
    <div class="admin-upload-block">
      <span>Cover</span>
      ${project.image ? `<img src="${assetUrl(project.image)}" alt="" />` : `<div class="admin-empty-image">No cover</div>`}
      <label>Upload cover<input type="file" accept="image/*" data-cover-upload /></label>
    </div>
    <div class="admin-upload-block">
      <span>Gallery</span>
      <div class="admin-dropzone" data-gallery-dropzone>
        <input type="file" accept="image/*" multiple data-gallery-upload />
        <div class="admin-dropzone-icon">+</div>
        <strong>Drop images here</strong>
        <p>or click to browse JPG, PNG, WEBP files</p>
      </div>
      <div class="admin-gallery">
        ${(project.gallery || []).map((image, index) => `
          <figure>
            <img src="${assetUrl(image)}" alt="" />
            <button type="button" class="admin-gallery-remove" data-remove-gallery="${index}">×</button>
          </figure>
        `).join("")}
      </div>
    </div>
    <button class="admin-danger-btn" type="button" data-delete-project>Delete project</button>
  `;

  tools.querySelector("[data-add-project]").addEventListener("click", addProject);
  tools.querySelectorAll("[data-project]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedProjectIndex = Number(button.dataset.project);
      renderAdmin();
    });
  });
  tools.querySelector("[data-project-published]").addEventListener("change", (event) => {
    project.published = event.target.checked;
  });
  tools.querySelector("[data-delete-project]").addEventListener("click", deleteProject);
  tools.querySelector("[data-cover-upload]").addEventListener("change", uploadCover);
  tools.querySelector("[data-gallery-upload]").addEventListener("change", uploadGallery);
  bindGalleryDropzone(tools.querySelector("[data-gallery-dropzone]"));
  tools.querySelectorAll("[data-remove-gallery]").forEach((button) => {
    button.addEventListener("click", () => {
      project.gallery = project.gallery.filter((_, index) => index !== Number(button.dataset.removeGallery));
      renderAdmin({ preserveToolsScroll: true });
    });
  });
  bindInputs();
}

function renderRepeaterTools(tools, key, fields, blank) {
  const items = state.content[key];
  tools.innerHTML = `
    <button class="admin-add-btn" type="button" data-add-item>+ Add item</button>
    ${items.map((item, index) => `
      <article class="admin-repeater-item">
        ${fields.map((fieldName) => {
          const path = `${key}.${index}.${fieldName}`;
          return fieldName === "content" || fieldName === "bio"
            ? area(fieldName, path, item[fieldName] || "")
            : field(fieldName, path, item[fieldName] || "");
        }).join("")}
        <button class="admin-danger-btn" type="button" data-remove-item="${index}">Remove</button>
      </article>
    `).join("")}
  `;
  tools.querySelector("[data-add-item]").addEventListener("click", () => {
    items.push({ ...blank });
    renderAdmin();
  });
  tools.querySelectorAll("[data-remove-item]").forEach((button) => {
    button.addEventListener("click", () => {
      items.splice(Number(button.dataset.removeItem), 1);
      renderAdmin();
    });
  });
  bindInputs();
}

function renderSettingsTools(tools) {
  const meta = state.content.meta;
  tools.innerHTML = `
    ${field("Site title", "meta.title", meta.title)}
    ${field("Email", "meta.email", meta.email)}
    ${area("Address", "meta.address", meta.address)}
    ${area("Footer copy", "meta.footerCopy", meta.footerCopy)}
    ${field("Copyright", "meta.copyright", meta.copyright)}
    ${field("Facebook", "meta.socials.facebook", meta.socials.facebook)}
    ${field("Instagram", "meta.socials.instagram", meta.socials.instagram)}
    ${field("LinkedIn", "meta.socials.linkedin", meta.socials.linkedin)}
  `;
  bindInputs();
}

function bindInputs() {
  app.querySelectorAll("[data-path]").forEach((input) => {
    if (input.tagName === "TEXTAREA") autoGrowTextarea(input);
    input.addEventListener("input", () => {
      if (input.tagName === "TEXTAREA") autoGrowTextarea(input);
      setValue(input.dataset.path, input.value);
      state.status = "Unsaved changes";
      const statusNode = app.querySelector(".site-admin-actions small");
      if (statusNode) statusNode.textContent = state.status;
    });
  });
}

function autoGrowTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

async function saveContent() {
  state.status = "Saving...";
  renderAdmin();
  try {
    state.content = await request("/public/website/admin/content", {
      method: "PUT",
      body: JSON.stringify(state.content),
    });
    state.status = "Saved";
    renderAdmin();
    app.querySelector("[data-preview]").contentWindow.location.reload();
  } catch (error) {
    state.status = error.message || "Save failed";
    renderAdmin();
  }
}

async function uploadCover(event) {
  const uploaded = await uploadFiles(event.target.files);
  if (uploaded[0]) {
    state.content.portfolio[state.selectedProjectIndex].image = uploaded[0].url;
    renderAdmin({ preserveToolsScroll: true });
  }
}

async function uploadGallery(event) {
  const uploaded = await uploadFiles(event.target.files);
  if (uploaded.length) {
    const project = state.content.portfolio[state.selectedProjectIndex];
    project.gallery = [...(project.gallery || []), ...uploaded.map((file) => file.url)];
    renderAdmin({ preserveToolsScroll: true });
  }
  event.target.value = "";
}

function bindGalleryDropzone(dropzone) {
  if (!dropzone) return;
  const input = dropzone.querySelector("[data-gallery-upload]");
  input?.addEventListener("click", (event) => event.stopPropagation());
  dropzone.addEventListener("click", () => input?.click());
  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("dragging");
  });
  dropzone.addEventListener("drop", async (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
    const uploaded = await uploadFiles(event.dataTransfer.files);
    if (uploaded.length) {
      const project = state.content.portfolio[state.selectedProjectIndex];
      project.gallery = [...(project.gallery || []), ...uploaded.map((file) => file.url)];
      renderAdmin({ preserveToolsScroll: true });
    }
  });
}

async function uploadFiles(files) {
  if (!files?.length) return [];
  const formData = new FormData();
  Array.from(files).forEach((file) => formData.append("files", file));
  const response = await fetch(`${apiBase()}/public/website/admin/uploads`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  if (!response.ok) throw new Error("Upload failed");
  return response.json();
}

function addProject() {
  const nextIndex = state.content.portfolio.length + 1;
  state.content.portfolio.push({
    title: "New project",
    slug: `new-project-${nextIndex}`,
    year: new Date().getFullYear().toString(),
    image: "",
    description: "",
    body: "",
    localDeliveryArchitect: "Shape Architects",
    gallery: [],
    published: true,
  });
  state.selectedProjectIndex = state.content.portfolio.length - 1;
  renderAdmin();
}

function deleteProject() {
  state.content.portfolio.splice(state.selectedProjectIndex, 1);
  state.selectedProjectIndex = Math.max(0, state.selectedProjectIndex - 1);
  renderAdmin();
}

function field(label, path, value) {
  return `<label class="admin-field"><span>${escapeHtml(label)}</span><input value="${escapeAttr(value || "")}" data-path="${path}" /></label>`;
}

function area(label, path, value) {
  return `<label class="admin-field"><span>${escapeHtml(label)}</span><textarea rows="4" data-path="${path}">${escapeHtml(value || "")}</textarea></label>`;
}

function setValue(path, value) {
  if (path.startsWith("project.")) {
    state.content.portfolio[state.selectedProjectIndex][path.replace("project.", "")] = value;
    return;
  }
  const parts = path.split(".");
  let target = state.content;
  while (parts.length > 1) {
    target = target[parts.shift()];
  }
  target[parts[0]] = value;
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (!options.skipAuth) {
    for (const [key, value] of Object.entries(authHeaders())) headers.set(key, value);
  }
  const response = await fetch(`${apiBase()}${path}`, { ...options, headers });
  if (!response.ok) {
    let message = `Request failed: ${response.status}`;
    try {
      const payload = await response.json();
      if (payload.message) message = payload.message;
    } catch {
      // Keep fallback message.
    }
    throw new Error(message);
  }
  return response.json();
}

function authHeaders() {
  return state.token ? { Authorization: `Bearer ${state.token}` } : {};
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

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
