# sub-app(APP1)

qiankun 微应用,交互场景里的**发送方**,端口 `7101`,由 `main-app` 通过 `loadMicroApp` 加载。

- 入口导出 `bootstrap` / `mount` / `update` / `unmount`;`mount` 接住宿主下发的 props,`update` 在不重新挂载的前提下刷新 props。
- 注册名 `sub-app` 必须与 `main-app` 中 `loadMicroApp({ name: 'sub-app' })` 一致。
- 独立运行时(`window.__POWERED_BY_QIANKUN__` 未定义)直接渲染自己,此时没有宿主可转发,发送按钮为禁用态。

```bash
pnpm install
pnpm dev   # http://localhost:7101
```
