import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';

/**
 * Flat ESLint config.
 *
 * `next lint` was removed in Next 16, so `npm run lint` calls ESLint directly
 * and this file is the whole configuration.  Two presets do the work:
 * `core-web-vitals` (Next's own rules, plus the performance ones it promotes
 * from warning to error) and `typescript`.
 *
 * Note on TypeScript: `typescript-eslint` refuses to load against the TS 7
 * native compiler, which ships no JavaScript compiler API.  That is why the
 * project pins `typescript@6` — linting TypeScript at all depends on it.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'node_modules/**',
      'Backend/**',
      'public/**',
      // A design reference kept alongside the app, not part of the build.
      'celeb_scoop_entertainment_celebrity_news.html',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,

  {
    /**
     * Adoption backlog.
     *
     * Linting arrived after the code did, and these three rules fire only on
     * pre-existing admin-UI and carousel code (~36 hits).  They are warnings
     * rather than errors so CI can start enforcing everything else today
     * instead of waiting on a refactor; clearing them and promoting each one
     * back to `error` is the follow-up:
     *
     *   - `no-explicit-any` — untyped catch blocks and API payloads in
     *     `app/admin/**`.
     *   - `set-state-in-effect` / `immutability` — mount-time effects that
     *     seed state from `window`/`document`, which want `useSyncExternalStore`
     *     or a lazy initialiser instead.
     */
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
];

export default config;
