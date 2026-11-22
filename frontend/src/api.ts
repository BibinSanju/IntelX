import axios from 'axios';
import DOMPurify from 'dompurify';
import { API_BASE } from './config';
import { useAuthStore } from './store/useAuthStore';

/**
 * Attach the JWT to every request sent to our backend, and log the user out
 * when the backend rejects the token (expired / invalid).
 */
export function setupApiClient() {
  axios.interceptors.request.use((config) => {
    const url = config.url || '';
    const token = useAuthStore.getState().token;
    if (token && url.startsWith(API_BASE)) {
      config.headers.set('Authorization', `Bearer ${token}`);
    }
    return config;
  });

  axios.interceptors.response.use(
    (response) => response,
    (error) => {
      const url: string = error?.config?.url || '';
      const isAuthCall = url.endsWith('/login') || url.endsWith('/signup');
      if (error?.response?.status === 401 && !isAuthCall && useAuthStore.getState().isAuthenticated) {
        useAuthStore.getState().logout();
      }
      return Promise.reject(error);
    }
  );
}

/** Sanitize AI/user-generated HTML before rendering it with dangerouslySetInnerHTML. */
export function safeHtml(html: string | null | undefined): { __html: string } {
  return { __html: DOMPurify.sanitize(html || '', { USE_PROFILES: { html: true } }) };
}
