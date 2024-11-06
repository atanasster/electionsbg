import { useEffect, useLayoutEffect } from 'react';

export const useCustomEffect =
  typeof window !== 'undefined' ? useLayoutEffect : useEffect;
