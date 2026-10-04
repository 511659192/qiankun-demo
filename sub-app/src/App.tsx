import { useState } from 'react'
import type { FormEvent } from 'react'
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
  const [draft, setDraft] = useState('')
  const sent = messages.filter((message) => message.from === 'app1')
  const received = messages.filter((message) => message.from === 'app2')
  const canSend = Boolean(send) && draft.trim().length > 0

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSend) return
    send?.('app1', draft)
    setDraft('')
  }

  return (
    <div className="micro-app">
      <h1>
        APP1 <span className="tag">sub-app · :7101</span>
      </h1>
      <p>
        {window.__POWERED_BY_QIANKUN__
          ? '当前由 main-app 通过 loadMicroApp 加载(运行在 qiankun 沙箱中)。'
          : '当前独立运行(未接入 qiankun)。'}
      </p>

      <form className="composer" onSubmit={submit}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={send ? '输入要发给 APP2 的内容' : '独立运行:没有宿主可转发'}
          disabled={!send}
        />
        <button type="submit" disabled={!canSend}>
          发送给 APP2
        </button>
      </form>

      <div className="columns">
        <section>
          <h2>
            我发出的 <span className="count">{sent.length}</span>
          </h2>
          {sent.length === 0 ? (
            <p className="empty">还没有发出消息</p>
          ) : (
            <ul>
              {sent.map((message) => (
                <li key={message.id}>
                  <span className="text">{message.text}</span>
                  <time>{message.at}</time>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>
            APP2 的回执 <span className="count">{received.length}</span>
          </h2>
          {received.length === 0 ? (
            <p className="empty">
              {send ? '还没有收到回执 —— 去下面 APP2 点一下「回执」' : '独立运行:没有宿主可转发'}
            </p>
          ) : (
            <ul>
              {received.map((message) => (
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
