export const GA_ID = "G-NWEG367BN9";
export const containsChatState = (value: string, base: string) => {
  try {
    const url = new URL(value, base);
    return url.searchParams.has("q") || url.searchParams.has("args");
  } catch {
    return false;
  }
};

// Enhanced Measurement can observe history changes independently of explicit
// page views. Disable collection before a prompt-bearing URL enters history,
// and keep it disabled for this document (including navigation away/back).
export const installChatAnalyticsPrivacy = () => {
  const disable = (url: string) => {
    if (containsChatState(url, window.location.origin))
      Object.assign(window, { [`ga-disable-${GA_ID}`]: true });
  };
  disable(window.location.href);
  disable(document.referrer);
  for (const method of ["pushState", "replaceState"] as const) {
    const original = window.history[method].bind(window.history);
    window.history[method] = (data, unused, url) => {
      if (url != null) disable(String(url));
      original(data, unused, url);
    };
  }
  window.addEventListener("popstate", () => disable(window.location.href));
};
