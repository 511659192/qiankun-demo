#!/usr/bin/env node
/**
 * 端到端冒烟测试(零依赖,需 Node >= 22 与一个 Chromium 内核浏览器)。
 *
 * 覆盖:宿主加载两个微应用、CSS 隔离、跨应用交互(发送/回执)、props 更新不重新挂载、
 * 卸载/重载、以及两个微应用的独立运行模式。
 *
 * 用法(改完代码后跑一遍):
 *   node scripts/smoke.mjs
 *   CHROME_PATH=/path/to/chrome node scripts/smoke.mjs       # 手动指定浏览器
 *   node scripts/smoke.mjs --headful                          # 开窗口,方便肉眼看
 *
 * 前置:三个 dev server 必须在跑(7099 / 7101 / 7102)。脚本会先探测端口,没起来直接报错退出。
 */
import { spawn } from 'node:child_process'
import { existsSync, readdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOST = process.env.SMOKE_HOST ?? 'http://localhost:7099'
const APPS = {
  main: 'http://localhost:7099',
  subApp: 'http://localhost:7101',
  subApp2: 'http://localhost:7102',
}
const DEBUG_PORT = Number(process.env.SMOKE_PORT ?? 9350)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function findBrowser() {
  const explicit = process.env.CHROME_PATH ?? process.env.CHROME
  if (explicit && existsSync(explicit)) return explicit

  const candidates = []
  const { LOCALAPPDATA = '', PROGRAMFILES = 'C:\\Program Files', 'PROGRAMFILES(X86)': PF86 = 'C:\\Program Files (x86)' } = process.env
  const playwrightRoot = join(LOCALAPPDATA, 'ms-playwright')
  if (existsSync(playwrightRoot)) {
    for (const dir of readdirSync(playwrightRoot)) {
      if (!dir.startsWith('chromium-')) continue
      candidates.push(join(playwrightRoot, dir, 'chrome-win64', 'chrome.exe'))
      candidates.push(join(playwrightRoot, dir, 'chrome-linux', 'chrome'))
      candidates.push(join(playwrightRoot, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'))
    }
  }
  candidates.push(
    join(PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PF86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(PF86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    join(homedir(), '.cache', 'ms-playwright'),
  )
  return candidates.find((candidate) => existsSync(candidate))
}

async function firstUnreachableApp() {
  for (const [name, url] of Object.entries(APPS)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) })
      if (!res.ok) return { name, url, status: res.status }
    } catch {
      return { name, url, status: 'unreachable' }
    }
  }
  return null
}

/** 极简 CDP 客户端:只用到导航、求值、键盘输入 */
async function connect(browser, headful) {
  const profileDir = join(
    process.env.TMPDIR ?? process.env.TEMP ?? '/tmp',
    `qiankun-smoke-${Date.now()}`,
  )
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ]
  if (!headful) args.unshift('--headless=new')
  const child = spawn(browser, args, { stdio: 'ignore' })

  let targets
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()
      if (targets.some((t) => t.type === 'page')) break
    } catch {
      /* 浏览器还没起来 */
    }
    await sleep(250)
  }
  const page = targets?.find((t) => t.type === 'page')
  if (!page) throw new Error('无法连接浏览器调试端口,可用 CHROME_PATH 指定浏览器路径')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('WebSocket 连接失败'))
  })

  let messageId = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    } else if (message.method) {
      events.push(message)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = ++messageId
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })

  await send('Runtime.enable')
  await send('Page.enable')

  return {
    events,
    evaluate: async (expression) =>
      (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result
        ?.result?.value,
    insertText: (text) => send('Input.insertText', { text }),
    navigate: async (url, wait = 7000) => {
      await send('Page.navigate', { url })
      await sleep(wait)
    },
    close: () => {
      ws.close()
      child.kill()
      // 清掉临时 profile,别在临时目录里堆积
      try {
        rmSync(profileDir, { recursive: true, force: true })
      } catch {
        /* 浏览器可能还没完全退出,留着也无害 */
      }
    },
  }
}

const results = []
const check = (name, actual, expected) => {
  const pass = JSON.stringify(actual) === JSON.stringify(expected)
  results.push(pass)
  console.log(
    `${pass ? '  ✓' : '  ✗'} ${name}${pass ? '' : `\n      实际 ${JSON.stringify(actual)}\n      期望 ${JSON.stringify(expected)}`}`,
  )
}

async function main() {
  const browser = findBrowser()
  if (!browser) {
    console.error('找不到 Chromium 内核浏览器,请设置 CHROME_PATH 指向 chrome/edge 可执行文件')
    process.exit(2)
  }

  const unreachable = await firstUnreachableApp()
  if (unreachable) {
    console.error(`[前置检查失败] ${unreachable.name} ${unreachable.url} 不可用(${unreachable.status})`)
    console.error('请先启动三个 dev server:')
    console.error('  cd main-app && pnpm dev    # 7099')
    console.error('  cd sub-app && pnpm dev     # 7101')
    console.error('  cd sub-app2 && pnpm dev    # 7102')
    process.exit(2)
  }

  const headful = process.argv.includes('--headful')
  console.log(`浏览器: ${browser}${headful ? '(有界面)' : '(headless)'}`)
  const page = await connect(browser, headful)
  const panels = `[...document.querySelectorAll('.micro-app-stack .sub-app-section')]`
  const app1 = `${panels}[0]`
  const app2 = `${panels}[1]`

  try {
    console.log('\n[1] 宿主加载两个微应用')
    await page.navigate(HOST, 8000)
    check('两个面板各挂载一个微应用', await page.evaluate(`${panels}.map(p => p.querySelector('.sub-app-container .micro-app h1').innerText.split(' ')[0])`), [ 'APP1', 'APP2' ])

    console.log('\n[2] CSS 隔离(两个微应用类名相同,主题必须互不污染)')
    const themes = await page.evaluate(
      `${panels}.map(p => getComputedStyle(p.querySelector('.micro-app')).backgroundColor)`,
    )
    check('两个微应用主题色不同', themes[0] !== themes[1], true)
    const tagColors = await page.evaluate(
      `${panels}.map(p => getComputedStyle(p.querySelector('.micro-app .tag')).backgroundColor)`,
    )
    check('同名 .tag 类各自生效(没有被对方覆盖)', tagColors[0] !== tagColors[1], true)
    // 微应用的 index.css 不再给 body 上样式,宿主的 body 必须保持自己的颜色
    check('宿主 body 未被微应用样式覆盖', await page.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgb(245, 247, 250)')

    console.log('\n[3] 跨应用交互:APP1 发送 → APP2 接收 → 回执 → APP1 接收')
    await page.evaluate(`${app1}.querySelector('.composer input').focus()`)
    await page.insertText('smoke-hello')
    await sleep(300)
    await page.evaluate(`${app1}.querySelector('.composer button').click()`)
    await sleep(900)
    check('宿主交互日志记录了这次发送', await page.evaluate(`[...document.querySelectorAll('.stage-log li .stage-text')].map(e => e.innerText)`), [ 'smoke-hello' ])
    check('APP2 通过 props 收到', await page.evaluate(`[...${app2}.querySelectorAll('.columns section')][0].querySelector('li .text').innerText`), 'smoke-hello')

    await page.evaluate(`${app2}.querySelector('.reply button').click()`)
    await sleep(900)
    check('APP1 收到回执', await page.evaluate(`[...${app1}.querySelectorAll('.columns section')][1].querySelector('li .text').innerText`), 'APP2 已收到 #1')

    console.log('\n[4] props 更新走 update 而不是重新挂载')
    await page.evaluate(`${app1}.querySelector('.composer input').focus()`)
    await page.insertText('draft-should-survive')
    await sleep(300)
    await page.evaluate(`${app2}.querySelector('.reply button').click()`)
    await sleep(900)
    check('APP1 未发送的草稿在 update 后仍在', await page.evaluate(`${app1}.querySelector('.composer input').value`), 'draft-should-survive')

    console.log('\n[5] 卸载 / 重新加载')
    await page.evaluate(`${app2}.querySelector('.sub-app-controls button').click()`)
    await sleep(2000)
    check('卸载后 APP2 的微应用 DOM 被移除', await page.evaluate(`${app2}.querySelectorAll('.micro-app').length`), 0)
    check('卸载 APP2 不影响 APP1', await page.evaluate(`${app1}.querySelector('.composer input').value`), 'draft-should-survive')
    await page.evaluate(`${app2}.querySelector('.sub-app-controls button').click()`)
    await sleep(3500)
    check('重新加载后宿主把历史消息重新下发', await page.evaluate(`[...${app2}.querySelectorAll('.columns section')][0].querySelector('li .text').innerText`), 'smoke-hello')

    console.log('\n[6] 控制台')
    const errors = page.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
    const consoleErrors = page.events
      .filter((e) => e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error')
      .map((e) => e.params.args.map((a) => a.value ?? a.description).join(' '))
    check('无页面异常', errors, [])
    check('无 console error', consoleErrors, [])

    console.log('\n[7] 微应用独立运行(不经过 qiankun)')
    await page.navigate(APPS.subApp, 4000)
    check('sub-app 独立渲染并提示独立运行', await page.evaluate(`document.querySelector('.micro-app')?.innerText.includes('当前独立运行')`), true)
    check('sub-app 独立运行时禁止发送(无宿主转发)', await page.evaluate(`document.querySelector('.composer button')?.disabled`), true)
    // 独立运行时 body 属于应用自己:主题背景与去默认边距都要生效
    check('sub-app 独立运行时 body 主题生效', await page.evaluate(`JSON.stringify([getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).marginTop])`), JSON.stringify([ 'rgb(238, 250, 243)', '0px' ]))
    await page.navigate(APPS.subApp2, 4000)
    check('sub-app2 独立渲染并提示独立运行', await page.evaluate(`document.querySelector('.micro-app')?.innerText.includes('当前独立运行')`), true)
    check('sub-app2 独立运行时禁止回执', await page.evaluate(`document.querySelector('.reply button')?.disabled`), true)
    check('sub-app2 独立运行时 body 主题生效', await page.evaluate(`JSON.stringify([getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).marginTop])`), JSON.stringify([ 'rgb(255, 251, 235)', '0px' ]))
  } finally {
    page.close()
  }

  const failed = results.filter((r) => !r).length
  console.log(`\n===== ${results.length - failed}/${results.length} PASS =====`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
