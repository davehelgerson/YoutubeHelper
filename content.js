const FILTER_CONTAINER_ID = "yh-filter-container";
const MAX_CREATORS = 30;

let activeCreator = null;
let refreshTimer = null;
let emptyCreatorRetryCount = 0;
const MAX_EMPTY_CREATOR_RETRIES = 12;

function getVideoItems() {
  return Array.from(document.querySelectorAll("ytd-rich-item-renderer"));
}

function normalizeCreatorKey(value) {
  return (value || "")
    .toLowerCase()
    .trim()
    .replace(/^@/, "")
    .replace(/\s+/g, "");
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
  const creatorCounts = new Map();

  items.forEach((item) => {
    const creator = getCreatorNameFromItem(item);
    if (!creator) {
      return;
    }

    const currentCount = creatorCounts.get(creator) || 0;
    creatorCounts.set(creator, currentCount + 1);
  });

  return Array.from(creatorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CREATORS)
    .map(([name]) => name);
}

function applyFilter(items) {
  items.forEach((item) => {
    const creator = getCreatorNameFromItem(item);
    const shouldHide = activeCreator && creator !== activeCreator;

    if (shouldHide) {
      item.classList.add("yh-hidden-by-filter");
    } else {
      item.classList.remove("yh-hidden-by-filter");
    }
  });
}

function clearButtonStates(container) {
  container.querySelectorAll(".yh-filter-button").forEach((button) => {
    button.classList.remove("active");
  });
}

function createButton(container, label, creatorValue, isActive, isSubscribed) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "yh-filter-button";
  button.dataset.creator = creatorValue || "";
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
    const value = candidate.dataset.creator || "";
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

    activeCreator = button.dataset.creator || null;
    setActiveButton(container);
    applyFilter(getVideoItems());
  });

  container.dataset.boundClick = "1";
}

function renderFilterBar(creators, subscribedCreatorKeys) {
  let container = document.getElementById(FILTER_CONTAINER_ID);

  if (!container) {
    container = document.createElement("div");
    container.id = FILTER_CONTAINER_ID;

    const app = document.querySelector("ytd-app");
    if (!app) {
      return;
    }

    app.prepend(container);
  }

  ensureFilterBarClickHandler(container);

  const creatorsKey = creators.join("||");
  const subscribedSignature = creators
    .map((creator) => (subscribedCreatorKeys.has(normalizeCreatorKey(creator)) ? "1" : "0"))
    .join("");

  if (
    container.dataset.creatorsKey === creatorsKey &&
    container.dataset.subscribedSignature === subscribedSignature
  ) {
    setActiveButton(container);
    return;
  }

  container.innerHTML = "";
  container.dataset.creatorsKey = creatorsKey;
  container.dataset.subscribedSignature = subscribedSignature;

  createButton(container, "All", "", !activeCreator, false);

  creators.forEach((creator) => {
    const isSubscribed = subscribedCreatorKeys.has(normalizeCreatorKey(creator));
    createButton(container, creator, creator, activeCreator === creator, isSubscribed);
  });

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
  getVideoItems().forEach((item) => item.classList.remove("yh-hidden-by-filter"));
}

function refresh() {
  if (!isHomePage()) {
    removeFilterBar();
    emptyCreatorRetryCount = 0;
    return;
  }

  const items = getVideoItems();
  if (!items.length) {
    return;
  }

  const creators = collectCreators(items);
  const subscribedCreatorKeys = getSubscribedCreatorKeys();
  renderFilterBar(creators, subscribedCreatorKeys);
  applyFilter(items);

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
