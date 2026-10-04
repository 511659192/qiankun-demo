import { useCallback, useRef, useState } from 'react'

/** 两个微应用的角色标识 */
export type AppRole = 'app1' | 'app2'

/** 一条跨应用消息 */
export type InteractionMessage = {
  id: number
  from: AppRole
  to: AppRole
  text: string
  at: string
}

/**
 * 宿主下发给两个微应用的同一份 props 契约。
 * 两个微应用各自声明一份同样的类型 —— 微前端里没有共享编译单元,契约靠约定保持一致。
 */
export type InteractionProps = {
  /** 完整消息流,由各应用按 from 字段筛选自己关心的部分 */
  messages: InteractionMessage[]
  /** 发一条消息,收件人由宿主按 from 推导 */
  send: (from: AppRole, text: string) => void
}

const other = (role: AppRole): AppRole => (role === 'app1' ? 'app2' : 'app1')

/**
 * 交互场景的状态中心,刻意放在宿主:
 * qiankun 3 没有 initGlobalState,跨应用通信统一走「宿主持有状态 -> 额外 props 下发」;
 * props 变化由 @qiankunjs/react 的 <MicroApp> 转成微应用的 update 生命周期(不重新挂载)。
 */
export function useInteraction() {
  const [messages, setMessages] = useState<InteractionMessage[]>([])
  const idRef = useRef(1)

  const send = useCallback((from: AppRole, text: string) => {
    const value = text.trim()
    if (!value) return
    setMessages((prev) => [
      ...prev,
      {
        id: idRef.current++,
        from,
        to: other(from),
        text: value,
        at: new Date().toLocaleTimeString(),
      },
    ])
  }, [])

  const reset = useCallback(() => setMessages([]), [])

  return { messages, send, reset }
}
