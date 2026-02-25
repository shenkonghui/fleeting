const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const yaml = require('js-yaml')
const crypto = require('crypto')

const GLOBAL_CONFIG_FILE = path.join(os.homedir(), '.fleeting.json')
function getGlobalConfig() {
  if (fs.existsSync(GLOBAL_CONFIG_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(GLOBAL_CONFIG_FILE, 'utf-8'))
    } catch(e){}
  }
  return { storageDir: path.join(os.homedir(), 'Documents', 'fleeting') }
}
function saveGlobalConfig(cfg) {
  fs.writeFileSync(GLOBAL_CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8')
}

let STORAGE_DIR = getGlobalConfig().storageDir

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
ipcMain.handle('get-memos', (_, { yearMonth, isPrivate } = {}) => {
  ensureDir()
  if (isPrivate) {
    const content = readPrivateContent()
    return parseMemos(content)
  }
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
function getConfigFilePath() {
  return path.join(STORAGE_DIR, 'config.yaml')
}

function readConfig() {
  const file = getConfigFilePath()
  if (!fs.existsSync(file)) return { tags: [] }
  return yaml.load(fs.readFileSync(file, 'utf-8')) || { tags: [] }
}

function saveConfig(cfg) {
  fs.writeFileSync(getConfigFilePath(), yaml.dump(cfg), 'utf-8')
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

ipcMain.handle('get-tags', (_, isPrivate) => {
  ensureDir()
  if (isPrivate) {
    const content = readPrivateContent()
    const set = new Set()
    ;(content.match(/#(\S+)/g) || []).forEach(t => set.add(t.slice(1)))
    return [...set].sort()
  }

  const cfg = readConfig()
  // 首次使用：扫描所有 md 文件补充标签
  if (!cfg.tags || cfg.tags.length === 0) {
    const files = fs.readdirSync(STORAGE_DIR).filter(f => /^\d{4}-\d{2}\.md$/.test(f))
    const set = new Set()
    for (const file of files) {
      const content = fs.readFileSync(path.join(STORAGE_DIR, file), 'utf-8')
      ;(content.match(/#(\S+)/g) || []).forEach(t => set.add(t.slice(1)))
    }
    if (set.size > 0) {
      cfg.tags = [...set].sort()
      saveConfig(cfg)
    }
  }
  return cfg.tags || []
})

// 添加新 memo
ipcMain.handle('add-memo', (_, { content, isPrivate } = {}) => {
  ensureDir()
  const ts = formatTimestamp()
  const block = `## ${ts}\n${content}\n---\n`
  if (isPrivate) {
    const text = readPrivateContent()
    writePrivateContent(text + block)
  } else {
    const file = getMonthFile()
    fs.appendFileSync(file, block, 'utf-8')
    syncTags(content)
  }
  return { timestamp: ts, content }
})

// 删除 memo（按时间戳匹配）
ipcMain.handle('delete-memo', (_, { yearMonth, timestamp, isPrivate }) => {
  if (isPrivate) {
    const content = readPrivateContent()
    const blocks = content.split(/\n---\n/)
    const filtered = blocks.filter(b => !b.includes(`## ${timestamp}`))
    writePrivateContent(filtered.join('\n---\n'))
    return true
  }

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
ipcMain.handle('search-memos', (_, { query, isPrivate }) => {
  ensureDir()
  const q = (query || '').toLowerCase()
  const tags = (q.match(/#\S+/g) || []).map(t => t.slice(1))        // ['tag1','tag2']
  const words = q.replace(/#\S+/g, '').trim().split(/\s+/).filter(Boolean) // 普通词

  const results = []

  if (isPrivate) {
    const content = readPrivateContent()
    parseMemos(content).forEach(memo => {
      const lower = memo.content.toLowerCase()
      const memoTags = (memo.content.match(/#\S+/g) || []).map(t => t.slice(1).toLowerCase())
      const tagMatch = tags.every(t => memoTags.includes(t))
      const wordMatch = words.every(w => lower.includes(w))
      if (tagMatch && wordMatch) results.push({ ...memo, yearMonth: '私密' })
    })
    return results
  }

  const files = fs.readdirSync(STORAGE_DIR).filter(f => /^\d{4}-\d{2}\.md$/.test(f)).sort().reverse()
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

// 编辑 memo（保存旧版本到历史记录）
ipcMain.handle('edit-memo', (_, { yearMonth, timestamp, newContent, isPrivate }) => {
  let text = ''
  let file = null
  if (isPrivate) {
    text = readPrivateContent()
  } else {
    file = yearMonth ? path.join(STORAGE_DIR, `${yearMonth}.md`) : getMonthFile()
    if (!fs.existsSync(file)) return false
    text = fs.readFileSync(file, 'utf-8')
  }

  let oldContent = null
  const updated = text.split(/\n---\n/).map(b => {
    if (!b.includes(`## ${timestamp}`)) return b
    oldContent = b.trim().replace(/^## [^\n]+\n/, '').trim()
    return `## ${timestamp}\n${newContent}`
  })
  
  if (oldContent !== null && !isPrivate) {
    const cfg = readConfig()
    cfg.history = cfg.history || {}
    cfg.history[timestamp] = cfg.history[timestamp] || []
    cfg.history[timestamp].unshift({ editedAt: formatTimestamp(), content: oldContent })
    if (cfg.history[timestamp].length > 10) cfg.history[timestamp].pop()
    saveConfig(cfg)
    syncTags(newContent)
  }

  if (isPrivate) {
    writePrivateContent(updated.join('\n---\n'))
  } else {
    fs.writeFileSync(file, updated.join('\n---\n'), 'utf-8')
  }
  return true
})

// 获取 memo 编辑历史
ipcMain.handle('get-history', (_, timestamp) => {
  const cfg = readConfig()
  return (cfg.history && cfg.history[timestamp]) || []
})

// ── 全局配置：支持修改数据目录 ────────────────────────────
ipcMain.handle('get-global-config', () => {
  return getGlobalConfig()
})

ipcMain.handle('set-global-config', (_, cfg) => {
  if (cfg.storageDir) {
    STORAGE_DIR = cfg.storageDir
    ensureDir()
  }
  saveGlobalConfig(cfg)
  return true
})

ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// 保存剪贴板图片到 .image 目录
ipcMain.handle('save-image', (_, { data, ext }) => {
  const imgDir = path.join(STORAGE_DIR, '.image')
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true })
  const filename = formatTimestamp().replace(/[: ]/g, '-') + '.' + ext
  const filepath = path.join(imgDir, filename)
  fs.writeFileSync(filepath, Buffer.from(data, 'base64'))
  return filepath
})

// 打开存储目录
ipcMain.handle('open-storage-dir', () => shell.openPath(STORAGE_DIR))

// ── 私密记录：加密与解密逻辑 ────────────────────────────
const ALGORITHM = 'aes-256-gcm'
let privatePassword = null

function encrypt(text, password) {
  const key = crypto.scryptSync(password, 'salt', 32)
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(text, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag().toString('hex')
  return `${iv.toString('hex')}:${authTag}:${encrypted}`
}

function decrypt(text, password) {
  const parts = text.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted format')
  const iv = Buffer.from(parts[0], 'hex')
  const authTag = Buffer.from(parts[1], 'hex')
  const encryptedText = Buffer.from(parts[2], 'hex')
  const key = crypto.scryptSync(password, 'salt', 32)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  let decrypted = decipher.update(encryptedText, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

ipcMain.handle('verify-private-password', (_, pwd) => {
  ensureDir()
  const file = path.join(STORAGE_DIR, 'private.md')
  if (!fs.existsSync(file)) {
    privatePassword = pwd
    fs.writeFileSync(file, encrypt('', pwd), 'utf-8')
    return true
  }
  try {
    const text = fs.readFileSync(file, 'utf-8')
    if (text) decrypt(text, pwd)
    privatePassword = pwd
    return true
  } catch (e) {
    return false
  }
})

function readPrivateContent() {
  const file = path.join(STORAGE_DIR, 'private.md')
  if (!fs.existsSync(file)) return ''
  const text = fs.readFileSync(file, 'utf-8')
  if (!text) return ''
  try {
    return decrypt(text, privatePassword)
  } catch(e) {
    return ''
  }
}

function writePrivateContent(content) {
  const file = path.join(STORAGE_DIR, 'private.md')
  fs.writeFileSync(file, encrypt(content, privatePassword), 'utf-8')
}

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
