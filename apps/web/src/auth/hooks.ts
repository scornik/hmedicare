import { useSyncExternalStore } from 'react';
import { getAccessToken, onAuthChange } from './session';

const subscribe = (cb: () => void) => onAuthChange(() => cb());

/** Signed-in flag for routing (UX only; the API authorizes every request). */
export const useSignedIn = () => useSyncExternalStore(subscribe, () => getAccessToken() !== null);
