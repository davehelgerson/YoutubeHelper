const FILTER_CONTAINER_ID = "yh-filter-container";
const MAX_CREATORS = 30;
const HIDE_MODE_STORAGE_KEY = "yh-hide-mode";
const HIDE_MODE_PRESERVE = "preserve";
const HIDE_MODE_COLLAPSE = "collapse";

let activeCreator = null;
let activeCreatorLabelKey = null;
let activeCreatorLabel = null;
let hideMode = HIDE_MODE_PRESERVE;
let refreshTimer = null;
let emptyCreatorRetryCount = 0;
const MAX_EMPTY_CREATOR_RETRIES = 12;
let expandAttempts = 0;
const MAX_EXPAND_ATTEMPTS = 5;

function getVideoItems() {
  const richItems = Array.from(document.querySelectorAll("ytd-rich-item-renderer"));
  const videoRenderers = Array.from(document.querySelectorAll("ytd-video-renderer"));
  return Array.from(new Set([...richItems, ...videoRenderers]));
}

function normalizeCreatorKey(value) {
  return (value || "")
    .toLowerCase()
    .trim()
    .replace(/^@/, "")
    .replace(/[\W_]+/g, "");
}

function creatorLooksLikeVideoCard(item) {
  return Boolean(item.querySelector("ytd-rich-grid-media, ytd-video-renderer"));
}

function extractCreatorFromHref(hrefValue) {
  if (!hrefValue) {
    return null;
  }

  try {
    const parsed = new URL(hrefValue, location.origin);
    const path = parsed.pathname || "";

    if (path.startsWith("/@")) {
      return path.slice(2).trim() ? `@${path.slice(2).trim()}` : null;
    }

    const channelPathMatch = path.match(/^\/(channel|c|user)\/([^/?#]+)/i);
    if (channelPathMatch?.[2]) {
      return channelPathMatch[2].trim();
    }
  } catch {
    return null;
  }

  return null;
}

function getCreatorKeyFromItem(item) {
  const cachedKey = item.dataset.yhCreatorKey || "";
  if (cachedKey) {
    return cachedKey;
  }

  const links = Array.from(item.querySelectorAll("a[href]"));
  const channelLinks = links.filter((link) => {
    const href = link.getAttribute("href") || "";
    return /\/(?:@|channel\/|c\/|user\/)/i.test(href);
  });

  for (const link of channelLinks) {
    const directText = normalizeCreatorKey(link.textContent || "");
    if (directText) {
      item.dataset.yhCreatorKey = directText;
      return directText;
    }

    const titleText = normalizeCreatorKey(link.getAttribute("title") || "");
    if (titleText) {
      item.dataset.yhCreatorKey = titleText;
      return titleText;
    }

    const ariaText = normalizeCreatorKey(link.getAttribute("aria-label") || "");
    if (ariaText) {
      item.dataset.yhCreatorKey = ariaText;
      return ariaText;
    }

    const fromHref = extractCreatorFromHref(link.getAttribute("href") || "");
    const hrefKey = normalizeCreatorKey(fromHref);
    if (hrefKey) {
      item.dataset.yhCreatorKey = hrefKey;
      return hrefKey;
    }
  }

  const fallbackName = getCreatorNameFromItem(item);
  const fallbackKey = normalizeCreatorKey(fallbackName);
  if (fallbackKey) {
    item.dataset.yhCreatorKey = fallbackKey;
  }
  return fallbackKey;
}

function getSubscribedCreatorKeys() {
  const keys = new Set();
  const links = Array.from(
    document.querySelectorAll("ytd-guide-renderer a[href], ytd-mini-guide-renderer a[href]")
  );

  links.forEach((link) => {
    const href = link.getAttribute("href") || "";
    if (!/\/(?:@|channel\/|c\/|user\/)/i.test(href)) {
      return;
    }

    const fromHref = extractCreatorFromHref(href);
    const hrefKey = normalizeCreatorKey(fromHref);
    if (hrefKey) {
      keys.add(hrefKey);
    }

    const text = (link.textContent || "").replace(/\s+/g, " ").trim();
    const textKey = normalizeCreatorKey(text);
    if (textKey) {
      keys.add(textKey);
    }

    const title = (link.getAttribute("title") || "").replace(/\s+/g, " ").trim();
    const titleKey = normalizeCreatorKey(title);
    if (titleKey) {
      keys.add(titleKey);
    }
  });

  return keys;
}

function tryExpandSubscriptionsGuide() {
  if (expandAttempts >= MAX_EXPAND_ATTEMPTS) {
    return false;
  }

  const candidateButtons = Array.from(
    document.querySelectorAll(
      "ytd-guide-renderer button, ytd-guide-renderer tp-yt-paper-item, ytd-guide-renderer a[role='button']"
    )
  );

  const showMoreButton = candidateButtons.find((element) => {
    const text = (element.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (!text) {
      return false;
    }

    const isMoreLabel =
      text === "show more" ||
      text === "more" ||
      text.includes("show more") ||
      text.endsWith("more");
    if (!isMoreLabel) {
      return false;
    }

    const section = element.closest(
      "ytd-guide-collapsible-section-entry-renderer, ytd-guide-section-renderer"
    );
    if (!section) {
      return false;
    }

    const sectionText = (section.textContent || "").toLowerCase();
    return sectionText.includes("subscriptions");
  });

  if (!showMoreButton) {
    return false;
  }

  showMoreButton.click();
  expandAttempts += 1;
  return true;
}

function getCreatorNameFromItem(item) {
  const links = Array.from(item.querySelectorAll("a[href]"));
  const channelLinks = links.filter((link) => {
    const href = link.getAttribute("href") || "";
    return /\/(?:@|channel\/|c\/|user\/)/i.test(href);
  });

  for (const link of channelLinks) {
    const directText = (link.textContent || "").replace(/\s+/g, " ").trim();
    if (directText) {
      return directText;
    }

    const titleText = (link.getAttribute("title") || "").replace(/\s+/g, " ").trim();
    if (titleText) {
      return titleText;
    }

    const ariaText = (link.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    if (ariaText) {
      return ariaText;
    }

    const fromHref = extractCreatorFromHref(link.getAttribute("href") || "");
    if (fromHref) {
      return fromHref;
    }
  }

  const channelLine = item.querySelector("#channel-name #text, #channel-name, ytd-channel-name");
  if (channelLine) {
    const clean = (channelLine.textContent || "").replace(/\s+/g, " ").trim();
    if (clean) {
      return clean;
    }
  }

  const titleLink = item.querySelector("a#video-title-link, a#video-title");
  const ariaLabel = titleLink?.getAttribute("aria-label") || "";
  const byMatch = ariaLabel.match(/\bby\s+(.+?)\s+(?:\d+\s+views?|views?|\d+\s+watching|streamed|ago)\b/i);
  if (byMatch?.[1]) {
    return byMatch[1].replace(/\s+/g, " ").trim();
  }

  const titleHrefFallback = extractCreatorFromHref(titleLink?.getAttribute("href") || "");
  if (titleHrefFallback) {
    return titleHrefFallback;
  }

  return null;
}

function collectCreators(items) {
  const creatorsByKey = new Map();

  items.forEach((item) => {
    const creatorKey = getCreatorKeyFromItem(item);
    if (!creatorKey) {
      return;
    }

    const creatorLabel = getCreatorNameFromItem(item) || `@${creatorKey}`;
    const existing = creatorsByKey.get(creatorKey);
    if (!existing) {
      creatorsByKey.set(creatorKey, {
        key: creatorKey,
        label: creatorLabel,
        count: 1,
      });
      return;
    }

    existing.count += 1;
    if ((!existing.label || existing.label.startsWith("@")) && creatorLabel) {
      existing.label = creatorLabel;
    }
  });

  return Array.from(creatorsByKey.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_CREATORS)
    .map((creator) => ({ key: creator.key, label: creator.label }));
}

function applyFilter(items) {
  if (!activeCreator) {
    items.forEach((item) => item.classList.remove("yh-hidden-by-filter"));
    return;
  }

  const evaluations = items.map((item) => {
    const creatorKey = getCreatorKeyFromItem(item);
    const creatorNameKey = normalizeCreatorKey(getCreatorNameFromItem(item));
    const hasIdentity = Boolean(creatorKey || creatorNameKey);

    const matchesActiveByKey = Boolean(creatorKey && creatorKey === activeCreator);
    const matchesActiveByName = Boolean(
      activeCreatorLabelKey && creatorNameKey && creatorNameKey === activeCreatorLabelKey
    );
    const matchesActiveLoosely = Boolean(
      activeCreatorLabelKey &&
        creatorNameKey &&
        (creatorNameKey.includes(activeCreatorLabelKey) || activeCreatorLabelKey.includes(creatorNameKey))
    );

    const isMatch = matchesActiveByKey || matchesActiveByName || matchesActiveLoosely;
    return { item, hasIdentity, isMatch };
  });

  const matchedCount = evaluations.filter((entry) => entry.isMatch).length;

  evaluations.forEach(({ item, hasIdentity, isMatch }) => {
    const shouldHide = matchedCount > 0 ? !isMatch : hasIdentity && !isMatch;
    if (shouldHide) {
      item.classList.add("yh-hidden-by-filter");
    } else {
      item.classList.remove("yh-hidden-by-filter");
    }
  });
}

function loadHideMode() {
  try {
    const savedValue = localStorage.getItem(HIDE_MODE_STORAGE_KEY);
    if (savedValue === HIDE_MODE_COLLAPSE || savedValue === HIDE_MODE_PRESERVE) {
      hideMode = savedValue;
      return;
    }
  } catch {
    // Ignore storage access issues and keep default mode.
  }

  hideMode = HIDE_MODE_PRESERVE;
}

function applyHideModeToDocument() {
  document.documentElement.dataset.yhHideMode = hideMode;
}

function setHideMode(nextMode) {
  hideMode = nextMode === HIDE_MODE_COLLAPSE ? HIDE_MODE_COLLAPSE : HIDE_MODE_PRESERVE;
  applyHideModeToDocument();

  try {
    localStorage.setItem(HIDE_MODE_STORAGE_KEY, hideMode);
  } catch {
    // Ignore storage write issues.
  }

  scheduleRefresh();
}

function addHideModeToggle(container) {
  const modeContainer = document.createElement("label");
  modeContainer.className = "yh-filter-mode-toggle";

  const modeText = document.createElement("span");
  modeText.className = "yh-filter-mode-label";
  modeText.textContent = "Keep space";

  const modeInput = document.createElement("input");
  modeInput.type = "checkbox";
  modeInput.className = "yh-filter-mode-input";
  modeInput.checked = hideMode === HIDE_MODE_PRESERVE;
  modeInput.setAttribute("aria-label", "Keep hidden videos in layout");

  modeInput.addEventListener("change", () => {
    setHideMode(modeInput.checked ? HIDE_MODE_PRESERVE : HIDE_MODE_COLLAPSE);
  });

  modeContainer.appendChild(modeText);
  modeContainer.appendChild(modeInput);
  container.appendChild(modeContainer);
}

function hideExtraPromptBoxes() {
  if (!isHomePage()) {
    return;
  }

  const hiddenTextSnippets = [
    "ask for videos any way you like",
    "free primetime movies",
  ];

  const knownPromptSelectors = [
    "ytd-feed-nudge-renderer",
    "ytd-guide-signin-promo-renderer",
    "ytd-primetime-promo-renderer",
    "ytd-statement-banner-renderer",
  ];

  knownPromptSelectors.forEach((selector) => {
    document.querySelectorAll(selector).forEach((element) => {
      element.classList.add("yh-hidden-extra");
    });
  });

  const richSections = Array.from(document.querySelectorAll("ytd-rich-section-renderer"));
  richSections.forEach((section) => {
    const sectionText = (section.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const matchesPromptText = hiddenTextSnippets.some((snippet) => sectionText.includes(snippet));
    if (matchesPromptText || sectionText.includes("beta")) {
      section.classList.add("yh-hidden-extra");
    }
  });

  const richItems = Array.from(document.querySelectorAll("ytd-rich-item-renderer"));
  richItems.forEach((item) => {
    const itemText = (item.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    const matchesPromptText = hiddenTextSnippets.some((snippet) => itemText.includes(snippet));
    if (matchesPromptText || itemText.includes("beta")) {
      item.classList.add("yh-hidden-extra");
    }
  });
}

function autoDismissNotInterestedPanels() {
  if (!isHomePage()) {
    return;
  }

  const panelSelectors = [
    "ytd-rich-section-renderer",
    "ytd-feed-nudge-renderer",
    "ytd-primetime-promo-renderer",
    "ytd-statement-banner-renderer",
    "ytd-reel-shelf-renderer",
  ].join(", ");

  const clickableSelectors = [
    "button",
    "tp-yt-paper-button",
    "yt-button-shape button",
    "a[role='button']",
  ].join(", ");

  const candidates = Array.from(document.querySelectorAll(clickableSelectors));
  candidates.forEach((element) => {
    const panel = element.closest(panelSelectors);
    if (!panel || panel.dataset.yhPanelDismissed === "1") {
      return;
    }

    if (element.dataset.yhAutoNotInterested === "1") {
      return;
    }

    const label = [
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || "",
      element.textContent || "",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();

    if (!label.includes("not interested")) {
      return;
    }

    element.dataset.yhAutoNotInterested = "1";
    panel.dataset.yhPanelDismissed = "1";
    element.click();
    panel.classList.add("yh-hidden-extra");
  });
}

function clearButtonStates(container) {
  container.querySelectorAll(".yh-filter-button").forEach((button) => {
    button.classList.remove("active");
  });
}

function createButton(container, label, creatorValue, creatorKey, isActive, isSubscribed) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yh-filter-button";
  button.dataset.creator = creatorValue || "";
  button.dataset.creatorKey = creatorKey || "";
  button.dataset.creatorLabelKey = normalizeCreatorKey(label);
  if (isActive) {
    button.classList.add("active");
  }
  if (isSubscribed) {
    button.classList.add("subscribed");
  }
  button.textContent = label;
  container.appendChild(button);
}

function setActiveButton(container) {
  clearButtonStates(container);
  const button = Array.from(container.querySelectorAll(".yh-filter-button")).find((candidate) => {
    const value = candidate.dataset.creatorKey || "";
    if (!activeCreator) {
      return value === "";
    }
    return value === activeCreator;
  });

  if (button) {
    button.classList.add("active");
  }
}

function ensureFilterBarClickHandler(container) {
  if (container.dataset.boundClick === "1") {
    return;
  }

  container.addEventListener("click", (event) => {
    const button = event.target.closest(".yh-filter-button");
    if (!button || !container.contains(button)) {
      return;
    }

    activeCreator = button.dataset.creatorKey || null;
    activeCreatorLabelKey = button.dataset.creatorLabelKey || null;
    activeCreatorLabel = button.dataset.creator || null;
    if (!activeCreator) {
      activeCreatorLabelKey = null;
      activeCreatorLabel = null;
    }

    refresh();
  });

  container.dataset.boundClick = "1";
}

function getFilterBarHost() {
  const chipsBar = document.querySelector("ytd-feed-filter-chip-bar-renderer");
  if (chipsBar && chipsBar.parentElement) {
    return { parent: chipsBar.parentElement, before: chipsBar };
  }

  const richGridHeader = document.querySelector("ytd-rich-grid-renderer #header");
  if (richGridHeader && richGridHeader.parentElement) {
    return { parent: richGridHeader.parentElement, before: richGridHeader };
  }

  const primaryColumn = document.querySelector("ytd-two-column-browse-results-renderer #primary");
  if (primaryColumn) {
    return { parent: primaryColumn, before: primaryColumn.firstElementChild };
  }

  return null;
}

function getCreatorSortToken(creator) {
  const label = (creator?.label || "").trim();
  if (label) {
    return label.replace(/^@/, "");
  }

  const key = (creator?.key || "").trim();
  return key.replace(/^@/, "");
}

function renderFilterBar(creators, subscribedCreatorKeys) {
  let container = document.getElementById(FILTER_CONTAINER_ID);

  if (!container) {
    container = document.createElement("div");
    container.id = FILTER_CONTAINER_ID;

    const host = getFilterBarHost();
    if (!host?.parent) {
      return;
    }

    host.parent.insertBefore(container, host.before || null);
  }

  const host = getFilterBarHost();
  if (host?.parent && container.parentElement !== host.parent) {
    host.parent.insertBefore(container, host.before || null);
  }

  ensureFilterBarClickHandler(container);

  const sortedCreators = [...creators].sort((left, right) => {
    const leftSubscribed = subscribedCreatorKeys.has(left.key);
    const rightSubscribed = subscribedCreatorKeys.has(right.key);

    if (leftSubscribed !== rightSubscribed) {
      return leftSubscribed ? -1 : 1;
    }

    const leftToken = getCreatorSortToken(left);
    const rightToken = getCreatorSortToken(right);

    return leftToken.localeCompare(rightToken, undefined, { sensitivity: "base" });
  });

  let visibleCreators = sortedCreators;
  if (activeCreator) {
    const selectedCreator = sortedCreators.find(
      (creator) =>
        creator.key === activeCreator || normalizeCreatorKey(creator.label) === activeCreatorLabelKey
    );

    const selectedLabel = selectedCreator?.label || activeCreatorLabel || `@${activeCreator}`;
    visibleCreators = [{ key: activeCreator, label: selectedLabel }];
  }

  const creatorsKey = visibleCreators.map((creator) => `${creator.key}:${creator.label}`).join("||");
  const subscribedSignature = visibleCreators
    .map((creator) => (subscribedCreatorKeys.has(creator.key) ? "1" : "0"))
    .join("");

  if (
    container.dataset.creatorsKey === creatorsKey &&
    container.dataset.subscribedSignature === subscribedSignature
  ) {
    setActiveButton(container);
    const existingModeInput = container.querySelector(".yh-filter-mode-input");
    if (existingModeInput) {
      existingModeInput.checked = hideMode === HIDE_MODE_PRESERVE;
    }
    return;
  }

  container.innerHTML = "";
  container.dataset.creatorsKey = creatorsKey;
  container.dataset.subscribedSignature = subscribedSignature;

  createButton(container, "All", "", "", !activeCreator, false);

  visibleCreators.forEach((creator) => {
    const isSubscribed = subscribedCreatorKeys.has(creator.key);
    createButton(
      container,
      creator.label,
      creator.label,
      creator.key,
      activeCreator === creator.key,
      isSubscribed
    );
  });

  addHideModeToggle(container);

  setActiveButton(container);
}

function isHomePage() {
  return location.pathname === "/";
}

function removeFilterBar() {
  const container = document.getElementById(FILTER_CONTAINER_ID);
  if (container) {
    container.remove();
  }

  activeCreator = null;
  activeCreatorLabelKey = null;
  activeCreatorLabel = null;
  getVideoItems().forEach((item) => item.classList.remove("yh-hidden-by-filter"));
}

function refresh() {
  if (!isHomePage()) {
    removeFilterBar();
    emptyCreatorRetryCount = 0;
    expandAttempts = 0;
    return;
  }

  const items = getVideoItems();
  if (!items.length) {
    return;
  }

  const didExpandSubscriptions = tryExpandSubscriptionsGuide();
  if (didExpandSubscriptions) {
    setTimeout(scheduleRefresh, 250);
  }

  const creators = collectCreators(items);
  const subscribedCreatorKeys = getSubscribedCreatorKeys();
  renderFilterBar(creators, subscribedCreatorKeys);
  applyFilter(items);
  hideExtraPromptBoxes();
  autoDismissNotInterestedPanels();

  if (!creators.length && emptyCreatorRetryCount < MAX_EMPTY_CREATOR_RETRIES) {
    emptyCreatorRetryCount += 1;
    setTimeout(refresh, 500);
    return;
  }

  if (creators.length) {
    emptyCreatorRetryCount = 0;
  }
}

function scheduleRefresh() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  refreshTimer = setTimeout(() => {
    refresh();
  }, 200);
}

loadHideMode();
applyHideModeToDocument();

const observer = new MutationObserver(() => {
  scheduleRefresh();
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

window.addEventListener("yt-navigate-finish", scheduleRefresh);
window.addEventListener("popstate", scheduleRefresh);

scheduleRefresh();
