import { lazy, Suspense, useState } from 'react'
import './App.css'
import { useInteraction, type AppRole } from './interaction'

/**
 * <MicroApp> 绑定组件按需加载:它连同 @qiankunjs/react、lodash、qiankun 都不进首屏 chunk,
 * 宿主外壳(含交互日志)先渲染,微应用运行时到位后再挂载。
 */
const MicroApp = lazy(async () => {
  const { MicroApp: Component } = await import('@qiankunjs/react')
  return { default: Component }
})

/**
 * 两个微应用面板。name 必须等于微应用 window['<name>'] 的兜底注册名,entry 是固定且唯一的端口。
 */
const PANELS = [
  {
    role: 'app1',
    name: 'sub-app',
    entry: '//localhost:7101',
    title: 'APP1 (sub-app)',
    description: '发送方:输入内容点「发送给 APP2」,消息交给宿主转发;下方能看到 APP2 的回执。',
  },
  {
    role: 'app2',
    name: 'sub-app2',
    entry: '//localhost:7102',
    title: 'APP2 (sub-app2)',
    description:
      '接收方:展示宿主下发的消息,并可以「回执」给 APP1;消息存在宿主,卸载再加载会重新下发。',
  },
] satisfies Array<{
  role: AppRole
  name: string
  entry: string
  title: string
  description: string
}>

function App() {
  const { messages, send, reset } = useInteraction()
  // 卸载 = 不渲染 <MicroApp>;它负责在组件卸载时调用微应用的 unmount
  const [unloaded, setUnloaded] = useState<AppRole[]>([])
  const toggle = (role: AppRole) =>
    setUnloaded((prev) => (prev.includes(role) ? prev.filter((item) => item !== role) : [...prev, role]))

  return (
    <div className="shell">
      <header className="shell-header">
        <h1>
          main-app <span className="tag">qiankun 主应用 · :7099</span>
        </h1>
        <p>
          用 <code>@qiankunjs/react</code> 的 <code>&lt;MicroApp /&gt;</code> 加载微应用并充当它们之间的消息中转:
          宿主持有消息列表,额外 props 变化时由组件调用微应用的 <code>update</code> 生命周期(不会重新挂载)。
        </p>
      </header>

      <section className="stage">
        <header className="stage-header">
          <h2>
            交互日志 <span className="tag">{messages.length} 条</span>
          </h2>
          <button type="button" onClick={reset} disabled={messages.length === 0}>
            清空
          </button>
        </header>
        {messages.length === 0 ? (
          <p className="stage-empty">
            还没有消息。在下面 APP1 的输入框里写点内容,点「发送给 APP2」。
          </p>
        ) : (
          <ol className="stage-log">
            {messages.map((message) => (
              <li key={message.id}>
                <span className="stage-route">
                  {message.from} → {message.to}
                </span>
                <span className="stage-text">{message.text}</span>
                <span className="stage-at">{message.at}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="micro-app-stack">
        {PANELS.map((panel) => {
          const shown = !unloaded.includes(panel.role)
          return (
            <section className="sub-app-section" key={panel.role}>
              <header className="sub-app-header">
                <h2>
                  {panel.title} <span className="tag">{panel.entry}</span>
                </h2>
                <div className="sub-app-controls">
                  <button type="button" onClick={() => toggle(panel.role)}>
                    {shown ? `卸载 ${panel.name}` : `加载 ${panel.name}`}
                  </button>
                </div>
              </header>
              <p className="sub-app-description">{panel.description}</p>
              {shown ? (
                <Suspense fallback={<p className="sub-app-loader">正在加载微应用运行时…</p>}>
                  <MicroApp
                    name={panel.name}
                    entry={panel.entry}
                    // 两个微应用用了同名的 .tag / .micro-app / .columns 等类名,
                    // 不隔离时后加载的样式会覆盖另一个(实测过),这里开运行时 CSS 隔离
                    settings={{ sandbox: { styleIsolation: true } }}
                    className="sub-app-container"
                    messages={messages}
                    send={send}
                    loader={(loading) => <p className="sub-app-loader">{loading ? '加载中…' : ''}</p>}
                    errorBoundary={(error) => (
                      <p className="sub-app-error">
                        {panel.name} 加载失败:{error.message} —— 确认 {panel.entry} 是否在运行
                      </p>
                    )}
                  />
                </Suspense>
              ) : (
                <p className="sub-app-container sub-app-placeholder">已卸载,宿主消息仍保留在交互日志里</p>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

export default App
