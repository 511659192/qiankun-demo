# qiankun-demo

qiankun 3.x 微前端 demo:一个主应用 + 两个微应用,演示 **两个微应用之间通过宿主交互**。

| 目录 | 角色 | 端口 | qiankun 侧配置 |
| --- | --- | --- | --- |
| `main-app/` | 主应用(宿主) | 7099 | `qiankun@3.0.0-rc.22` + `@qiankunjs/react` 的 `<MicroApp>` |
| `sub-app/` | 微应用 **APP1**(发送方) | 7101 | `@qiankunjs/bundler-plugin` 的 vite 插件 |
| `sub-app2/` | 微应用 **APP2**(接收 + 回执) | 7102 | 同上 |

## 启动

三个应用是各自独立的 pnpm 工程(各有自己的 `package.json` / `pnpm-lock.yaml` / `node_modules`),分别开一个终端启动:

```bash
cd main-app  && pnpm install && pnpm dev    # http://localhost:7099
cd sub-app   && pnpm install && pnpm dev    # http://localhost:7101
cd sub-app2  && pnpm install && pnpm dev    # http://localhost:7102
```

主应用在 `entry` 里**硬引用**微应用的端口,所以哪个微应用没起来,对应面板就会显示 `error`。页面显示 `error` 时先确认对应端口是否在监听:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:7102/
```

修复后刷新页面(或点面板上的「加载」按钮)即可,不需要重启主应用。

单独构建 / 检查任一应用:

```bash
cd main-app && pnpm build && pnpm lint
```

## 自测(端到端冒烟)

三个 dev server 都在跑的前提下,根目录执行:

```bash
node scripts/smoke.mjs            # 需 Node >= 22;自动查找 chromium 内核浏览器
CHROME_PATH=/path/to/chrome node scripts/smoke.mjs   # 找不到浏览器时手动指定
node scripts/smoke.mjs --headful # 开窗口,方便肉眼看
```

脚本会先探测三个端口是否都在监听(缺哪个就提示去哪启动),然后用 CDP 跑 19 条断言:两个微应用挂载、**CSS 隔离**(同名类不互相覆盖、宿主 body 不被改)、跨应用发送/回执、props 更新走 `update` 而不重新挂载、卸载/重载后宿主消息重新下发、无页面异常与 console error、以及两个微应用的独立运行模式(含独立运行时的 body 主题)。全部通过退出码 0,任一失败退出码 1。

## 交互场景:APP1 ⇄ APP2

链路:APP1 输入内容 → 调 `props.send('app1', text)` → 宿主把消息追加到自己的状态 → 额外 props 变化时 `<MicroApp>` 调用微应用的 `update` 生命周期把新数据下发 → APP2 显示;APP2 点「回执给 APP1」沿同一条链路反向走一次。宿主页面上方还有一块「交互日志」,能直观看到消息只在宿主里存一份。

通信契约(两个微应用各自声明一份,见 `sub-app/src/App.tsx` 与 `sub-app2/src/App.tsx`):

```ts
type Message = { id: number; from: 'app1' | 'app2'; to: 'app1' | 'app2'; text: string; at: string }
type InteractionProps = {
  messages: Message[]                        // 完整消息流,各应用自己按 from 筛选
  send: (from: 'app1' | 'app2', text: string) => void  // 发给另一个应用,由宿主路由
}
```

关键实现点:

- **qiankun 3 没有 `initGlobalState`**,跨应用状态统一由宿主持有,再以额外 props 下发(见 `main-app/src/interaction.ts`)。
- 下发与更新全部交给 `@qiankunjs/react` 的 `<MicroApp name entry {...extraProps} />`:挂载时随 `loadMicroApp` 把 props 交给微应用的 `mount`,额外 props 变化时调用微应用的 `update`,**不重新挂载**。挂载/卸载串行化、StrictMode 双挂载、loading/error 槽位、props 深比较(避免无谓更新)也都是它内置的。
- 卸载微应用 = 不再渲染 `<MicroApp>`(见 `main-app/src/App.tsx` 的 `unloaded` 状态),组件卸载时它负责调用 `unmount`。
- 微应用入口里 `update` 只替换 props 并复用同一个 React root 重新渲染(见 `sub-app/src/main.tsx`),所以组件内部 state 不会被重置。
- 函数也能作为 prop 传下去(宿主闭包在沙箱里被调用),因此不需要自己去挂 `window` 全局事件总线 —— 沙箱环境下 `window` 是代理,跨应用直接读写 `window` 并不可靠。
- 状态存在宿主,所以**卸载微应用再重新加载,历史消息会重新下发**,不会丢。
- 宿主给每个微应用开了 **`styleIsolation`**(`settings={{ sandbox: { styleIsolation: true } }}`):两个微应用定义了同名类(`.tag` / `.micro-app` / `.columns`),不隔离时后挂载的会覆盖先挂载的。开启后微应用样式被运行时 `@scope` 包住、只注入自己的容器,卸载时随之移除。**注意 `@scope` 需要 Chrome 118+ / Safari 17.4+**。
- 微应用的主题样式(**包括 `body` 规则**)只用两个选择器:自己的根类 `.micro-app`,以及 `body.micro-app-standalone` —— 后者由 `main.tsx` 只在**独立运行**分支给 body 打标记,所以被 qiankun 加载时绝不会碰到宿主的 `body`。
- 宿主里的 `<MicroApp>` 用 `lazy(() => import('@qiankunjs/react'))` 按需加载:微应用运行时(qiankun + 绑定组件)拆成独立 chunk,宿主外壳先渲染。入口 chunk 224.98 kB / 运行时 chunk 172.65 kB。

## 新增一个微应用

微应用侧:新建 Vite 应用 → 装 `@qiankunjs/bundler-plugin` → `vite.config.ts` 里加 `qiankun()` 并锁定唯一端口 → 入口导出 `bootstrap` / `mount` / `update` / `unmount`,并保留 `window.__POWERED_BY_QIANKUN__` 未定义时直接渲染自己的分支。

主应用侧:用 `@qiankunjs/react` 的 `<MicroApp name="..." entry="//localhost:710X" />` 包一层即可(name 必须等于微应用 `window['<name>']` 的兜底注册名);要下发数据就把它们作为额外 props 传进 `<MicroApp>`,组件会在微应用挂载后自动转到 `update` 生命周期。
