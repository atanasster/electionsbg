// Google Analytics utility functions
declare global {
  interface Window {
    gtag?: (
      command: string,
      targetId: string,
      config?: Record<string, unknown>,
    ) => void;
  }
}

/**
 * Send a custom event to Google Analytics
 */
export const trackEvent = (
  eventName: string,
  eventParams?: Record<string, unknown>,
) => {
  if (typeof window !== "undefined" && window.gtag) {
    window.gtag("event", eventName, eventParams);
  }
};

/**
 * Track search events
 */
export const trackSearch = (searchTerm: string, resultCount?: number) => {
  trackEvent("search", {
    search_term: searchTerm,
    result_count: resultCount,
  });
};

/**
 * Track search result selection
 */
export const trackSearchSelection = (
  searchTerm: string,
  selectedType: string,
  selectedKey: string,
  selectedLabel: string,
) => {
  trackEvent("select_search_result", {
    search_term: searchTerm,
    result_type: selectedType,
    result_key: selectedKey,
    result_label: selectedLabel,
  });
};
