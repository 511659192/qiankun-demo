# Create a main (host) app

Prerequisites: the shared facts in [SKILL.md](../SKILL.md) — app name, framework, port, package versions.

1. Scaffold the shell (any framework; below assumes React + TS on port `7099`) and install qiankun:

   ```bash
   pnpm create vite <main-app-name> --template react-ts
   pnpm add qiankun@rc @qiankunjs/react@rc   # vue shell: @qiankunjs/vue@rc
   ```

   Pin the port in `vite.config.ts` (`server: { port: 7099, strictPort: true }`).

2. Pick ONE loading style:

   **`MicroApp` component (recommended for React/Vue shells)** — mounts on render, unmounts on component unmount, serializes mount/unmount (StrictMode-safe), deep-compares extra props, and owns loading/error slots. Extra props are forwarded to the sub app: first delivery via `mount`, later changes via its `update` lifecycle — without remounting:

   ```tsx
   import { lazy, Suspense, useState } from 'react';
   import { MicroApp } from '@qiankunjs/react'; // same component name in @qiankunjs/vue

   // optional: keeps qiankun out of the entry chunk (measured: 398 kB entry -> 225 kB + 173 kB on-demand chunk)
   const LazyMicroApp = lazy(async () => ({ default: (await import('@qiankunjs/react')).MicroApp }));

   export default function SubAppPage() {
     const [greeting, setGreeting] = useState('hello');
     return (
       <Suspense fallback={<p>loading runtime…</p>}>
         <LazyMicroApp
           name="<app-name>"
           entry="//localhost:7101"
           loader={(loading) => (loading ? <p>loading…</p> : null)}
           errorBoundary={(error) => <p>{`failed: ${error.message}`}</p>}
           settings={{ sandbox: { styleIsolation: true } }} // see step 3
           greeting={greeting}                              // extra props are forwarded
           onGreet={(next) => setGreeting(next)}            // function props work across the sandbox
         />
       </Suspense>
     );
   }
   ```

   Practice notes (verified against `@qiankunjs/react@0.0.1-rc.15`):

   - Don't pass `autoSetLoading` alongside a `loader` slot — the slot wins and the flag is dead config.
   - Extra props are deep-compared (`lodash/isEqual`): a re-render with equal values sends no `update`. `loader`/`errorBoundary` are stripped before the diff, so inline closures are fine.
   - Updates are applied only while the app is `MOUNTED` and not mid-unmount, queued behind `mountPromise`. In dev the binding logs every update and can warn `updating too many times in a short time(200ms)` — the first update per app always trips it (its timestamp is taken before `mountPromise` settles). One warning per app is noise; investigate only if it repeats on every update.
   - Don't build a `window` event bus for host↔app data — each app's `window` is a proxied sandbox. Function props (host closures called from inside the sandbox) are the working channel, and host-held state survives sub app unmount (re-delivered on the next mount).
   - For several micro apps on one page: one port per app, `styleIsolation` per app, and themes on each app's root element (see [create-micro-app.md](create-micro-app.md)).

   **Router-driven registration (framework-agnostic)** — qiankun mounts/unmounts apps as the URL matches `activeRule`. Put this in the shell entry, once:

   ```ts
   import { registerMicroApps, start } from 'qiankun';

   registerMicroApps([
     {
       name: '<app-name>',
       entry: '//localhost:7101',
       container: '#micro-app-container', // an element the shell always renders
       activeRule: '/<app-name>',
     },
   ]);

   start();
   ```

   For full manual control there is also `loadMicroApp({ name, entry, container }, configuration)` — it returns a handle; you own calling `.unmount()` when the app leaves.

3. Per-app configuration: the third argument of `loadMicroApp`, the `settings` prop of the `MicroApp` component, or per-app fields in `registerMicroApps`. `sandbox` defaults to on. Scope a sub app's CSS with runtime `@scope` by enabling style isolation:

   ```tsx
   <MicroApp … settings={{ sandbox: { styleIsolation: true } }} />
   ```

   The sub app's styles are then rewritten to `@scope ([data-name="<app>"])`, injected inside its own container, and removed with it. Enable it whenever several micro apps (or the host) share class names — without it the last-mounted app's CSS wins over earlier ones, host `body` styles included. `@scope` needs Chrome 118+ / Safari 17.4+; on older engines the scoped styles are dropped entirely.

   (Some docs call this prop `configuration`; the installed rc packages name it `settings` — re-check the installed typings when upgrading.)

## Verify

1. Run both dev servers, open the main app at `http://localhost:7099`, navigate to the sub app route — it must mount inside the shell with no console errors.
2. Leave the sub app route — its DOM must be removed (unmount actually ran).
3. The sub app must still render standalone at `http://localhost:7101` — see [create-micro-app.md](create-micro-app.md).
4. With two micro apps mounted that share class names: the same selector must resolve differently per panel, and the host's `body` background must still be the host's own (see the body rule in [create-micro-app.md](create-micro-app.md)).
5. Changing a forwarded prop must not remount the sub app: keep local state inside it (e.g. typed input), trigger the update, and confirm the state survived.
6. Unmounting one micro app must leave other mounted apps untouched.
