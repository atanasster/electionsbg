import { QueryClient } from "@tanstack/react-query";

// All election data is static JSON — once fetched, it never changes within a
// session. Cache aggressively so navigating back to a screen is instant.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
});
