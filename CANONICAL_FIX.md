# Google Search Console Canonical URL Fix

## Problem
GSC reported "Duplicate without user-selected canonical" for 191 pages (mainly `/section/*` URLs).

## Root Cause
- Static canonical tag in `index.html` pointed to `https://electionsbg.com` for ALL pages
- No dynamic canonical tags for individual pages
- Google couldn't determine the preferred URL for each page

## Solution Implemented

### 1. Removed Static Canonical (✅ Completed)
**File:** `index.html`
- Removed: `<link rel="canonical" href="https://electionsbg.com" />`

### 2. Added Dynamic Canonical Injection (✅ Completed)
**File:** `src/ux/SEO.tsx`
- Added `canonical` prop (optional)
- Added `useEffect` hook to dynamically inject canonical URLs
- Uses `location.pathname` to auto-generate canonical URLs
- Format: `https://electionsbg.com{pathname}`

### How It Works

```tsx
// Automatic canonical based on current URL
<SEO 
  title="Section Details"
  description="..." 
/>
// Result: <link rel="canonical" href="https://electionsbg.com/section/042200011" />

// Custom canonical URL
<SEO 
  title="Section Details"
  description="..."
  canonical="https://electionsbg.com/custom-url"
/>
// Result: <link rel="canonical" href="https://electionsbg.com/custom-url" />
```

## Why This Works for Static Sites

**Google's JavaScript Support:**
- Google's crawler executes JavaScript and reads dynamically injected meta tags
- The canonical tag is injected via `useEffect` when the page loads
- This is a standard approach for SPAs (Single Page Applications)

**Benefits:**
- ✅ Each page gets its own unique canonical URL
- ✅ No build-time pre-rendering needed
- ✅ Works with your existing Vite static build
- ✅ Automatic cleanup when navigating between pages

## Testing

1. **Build the site:**
   ```bash
   npm run build
   ```

2. **Preview locally:**
   ```bash
   npm run preview
   ```

3. **Verify canonical tags:**
   - Open browser DevTools
   - Navigate to different pages (e.g., `/section/042200011`)
   - Check `<head>` for: `<link rel="canonical" href="https://electionsbg.com/section/042200011">`

4. **Deploy and validate:**
   - Deploy to production
   - Use Google's [Rich Results Test](https://search.google.com/test/rich-results)
   - Or use [URL Inspection Tool](https://search.google.com/search-console) in GSC
   - Click "Validate Fix" in GSC after deployment

## Expected Timeline

- **Immediate:** Canonical tags will be present on all pages
- **1-2 weeks:** Google will re-crawl and validate the fix
- **2-4 weeks:** GSC issue count should decrease to 0

## Alternative: Pre-rendering (If Needed)

If Google doesn't properly index the JavaScript-injected canonicals (unlikely), you can:
1. Use `vite-plugin-ssr` or similar for SSG
2. Generate static HTML files with canonical tags at build time
3. This is more complex but provides canonical tags in the initial HTML

## Files Modified

- ✅ `index.html` - Removed static canonical
- ✅ `src/ux/SEO.tsx` - Added dynamic canonical injection
