import { useState } from 'react'
import './App.css'

/**
 * 与宿主的通信契约。微前端里两个应用是独立工程,没有共享编译单元,
 * 所以这里各自声明一份同样的结构 —— 改动契约要两边一起改。
 */
export type Message = {
  id: number
  from: 'app1' | 'app2'
  to: 'app1' | 'app2'
  text: string
  at: string
}

export type InteractionProps = {
  /** 完整消息流(宿主下发全量,各应用自己按 from 筛选) */
  messages: Message[]
  /** 发消息给另一个应用,实际由宿主路由 */
  send: (from: 'app1' | 'app2', text: string) => void
}

function App({ messages = [], send }: Partial<InteractionProps> = {}) {
  // 挂载时刻:卸载后重新加载会变化,可用来确认拿到的是新实例
  const [mountedAt] = useState(() => new Date().toLocaleTimeString())
  const received = messages.filter((message) => message.from === 'app1')
  const replied = messages.filter((message) => message.from === 'app2')
  const latest = received.at(-1)

  return (
    <div className="micro-app">
      <h1>
        APP2 <span className="tag">sub-app2 · :7103</span>
      </h1>
      <p>
        {window.__POWERED_BY_QIANKUN__
          ? '当前由 main-app 通过 loadMicroApp 加载(运行在 qiankun 沙箱中)。'
          : '当前独立运行(未接入 qiankun)。'}
      </p>
      <p className="meta">挂载时刻「{mountedAt}」· 收到的消息来自宿主 props</p>

      <div className="reply">
        <button type="button" onClick={() => latest && send?.('app2', `APP2 已收到 #${latest.id}`)} disabled={!send || !latest}>
          回执给 APP1
        </button>
        <span className="hint">
          {latest
            ? `将对最新一条执行回执:${latest.text}`
            : send
              ? '还没有收到 APP1 的消息 —— 先去上面 APP1 发一条'
              : '独立运行:没有宿主可转发'}
        </span>
      </div>

      <div className="columns">
        <section>
          <h2>
            收到 APP1 <span className="count">{received.length}</span>
          </h2>
          {received.length === 0 ? (
            <p className="empty">空</p>
          ) : (
            <ul>
              {received.map((message) => (
                <li key={message.id}>
                  <span className="seq">#{message.id}</span>
                  <span className="text">{message.text}</span>
                  <time>{message.at}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>
            我发出的回执 <span className="count">{replied.length}</span>
          </h2>
          {replied.length === 0 ? (
            <p className="empty">空</p>
          ) : (
            <ul>
              {replied.map((message) => (
                <li key={message.id}>
                  <span className="text">{message.text}</span>
                  <time>{message.at}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

export default App
