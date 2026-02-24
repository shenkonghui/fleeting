const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const yaml = require('js-yaml')

const STORAGE_DIR = path.join(os.homedir(), 'Documents', 'fleeting')

function ensureDir() {
  if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR, { recursive: true })
}

function getMonthFile(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  return path.join(STORAGE_DIR, `${y}-${m}.md`)
}

// 解析 markdown 文件中的 memos，每条以 ## YYYY-MM-DD HH:MM:SS 开头，---分隔
function parseMemos(content) {
  const blocks = content.split(/\n---\n/)
  const memos = []
  const re = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\n([\s\S]*)$/
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    const m = trimmed.match(re)
    if (m) {
      memos.push({ timestamp: m[1], content: m[2].trim() })
    }
  }
  return memos.reverse() // 最新在前
}

function formatTimestamp(date = new Date()) {
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

// 读取某个月的 memos
ipcMain.handle('get-memos', (_, yearMonth) => {
  ensureDir()
  let file
  if (yearMonth) {
    file = path.join(STORAGE_DIR, `${yearMonth}.md`)
  } else {
    file = getMonthFile()
  }
  if (!fs.existsSync(file)) return []
  const content = fs.readFileSync(file, 'utf-8')
  return parseMemos(content)
})

// 获取所有月份列表
ipcMain.handle('get-months', () => {
  ensureDir()
  return fs.readdirSync(STORAGE_DIR)
    .filter(f => /^\d{4}-\d{2}\.md$/.test(f))
    .map(f => f.replace('.md', ''))
    .sort()
    .reverse()
})

// ── YAML 配置：标签管理 ───────────────────────────────
const CONFIG_FILE = path.join(STORAGE_DIR, 'config.yaml')

function readConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return { tags: [] }
  return yaml.load(fs.readFileSync(CONFIG_FILE, 'utf-8')) || { tags: [] }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, yaml.dump(cfg), 'utf-8')
}

function syncTags(content) {
  const found = (content.match(/#(\S+)/g) || []).map(t => t.slice(1))
  if (!found.length) return
  const cfg = readConfig()
  const set = new Set(cfg.tags || [])
  found.forEach(t => set.add(t))
  cfg.tags = [...set].sort()
  saveConfig(cfg)
}

ipcMain.handle('get-tags', () => {
  ensureDir()
  return readConfig().tags || []
})

// 添加新 memo
ipcMain.handle('add-memo', (_, content) => {
  ensureDir()
  const file = getMonthFile()
  const ts = formatTimestamp()
  const block = `## ${ts}\n${content}\n---\n`
  fs.appendFileSync(file, block, 'utf-8')
  syncTags(content)
  return { timestamp: ts, content }
})

// 删除 memo（按时间戳匹配）
ipcMain.handle('delete-memo', (_, { yearMonth, timestamp }) => {
  const file = yearMonth
    ? path.join(STORAGE_DIR, `${yearMonth}.md`)
    : getMonthFile()
  if (!fs.existsSync(file)) return false
  const content = fs.readFileSync(file, 'utf-8')
  const blocks = content.split(/\n---\n/)
  const filtered = blocks.filter(b => !b.includes(`## ${timestamp}`))
  fs.writeFileSync(file, filtered.join('\n---\n'), 'utf-8')
  return true
})

// 跨所有月份搜索（返回带 yearMonth 字段的 memo 列表）
ipcMain.handle('search-memos', (_, query) => {
  ensureDir()
  const files = fs.readdirSync(STORAGE_DIR).filter(f => /^\d{4}-\d{2}\.md$/.test(f)).sort().reverse()
  const q = (query || '').toLowerCase()
  const tags = (q.match(/#\S+/g) || []).map(t => t.slice(1))        // ['tag1','tag2']
  const words = q.replace(/#\S+/g, '').trim().split(/\s+/).filter(Boolean) // 普通词

  const results = []
  for (const file of files) {
    const ym = file.replace('.md', '')
    const content = fs.readFileSync(path.join(STORAGE_DIR, file), 'utf-8')
    parseMemos(content).forEach(memo => {
      const lower = memo.content.toLowerCase()
      const memoTags = (memo.content.match(/#\S+/g) || []).map(t => t.slice(1).toLowerCase())
      const tagMatch = tags.every(t => memoTags.includes(t))
      const wordMatch = words.every(w => lower.includes(w))
      if (tagMatch && wordMatch) results.push({ ...memo, yearMonth: ym })
    })
  }
  return results
})

// 打开存储目录
ipcMain.handle('open-storage-dir', () => shell.openPath(STORAGE_DIR))

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    },
  })
  win.loadFile('renderer/index.html')
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
