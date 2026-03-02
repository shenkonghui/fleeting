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

// 解析 markdown 文件中的 memos，每条以 ## YYYY-MM-DD HH:MM:SS 开头（按标题分割，内容中的 --- 不会误伤）
function parseMemos(content) {
  const blocks = content.split(/\n(?=## \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\n)/)
  const memos = []
  const re = /^## (\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\n([\s\S]*)$/
  for (const block of blocks) {
    const trimmed = block.trim()
    if (!trimmed) continue
    const m = trimmed.match(re)
    if (m) {
      // 去掉块尾的分隔符（仅剥 ---**---，--- 属于用户内容保留）
      let body = m[2].trim().replace(/(\n---\*\*---)+\s*$/, '')
      memos.push({ timestamp: m[1], content: body })
    }
  }
  return memos.reverse() // 最新在前
}

// 序列化 memos 回文件内容（写回时用 ---**--- 分隔，但解析不依赖分隔符）
function serializeMemos(memos) {
  return memos.map(m => `## ${m.timestamp}\n${m.content}\n---**---\n`).join('')
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
  const found = (content.match(/#([^#\s]\S*)/g) || []).map(t => t.slice(1))
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
    ;(content.match(/#([^#\s]\S*)/g) || []).forEach(t => set.add(t.slice(1)))
    return [...set].sort()
  }

  // 每次从当前所有 memo 内容重算标签，已删除记录对应的标签会被移除
  const files = fs.readdirSync(STORAGE_DIR).filter(f => /^\d{4}-\d{2}\.md$/.test(f))
  const set = new Set()
  for (const file of files) {
    const content = fs.readFileSync(path.join(STORAGE_DIR, file), 'utf-8')
    ;(content.match(/#([^#\s]\S*)/g) || []).forEach(t => set.add(t.slice(1)))
  }
  const tags = [...set].sort()
  const cfg = readConfig()
  cfg.tags = tags
  saveConfig(cfg)
  return tags
})

// 添加新 memo
ipcMain.handle('add-memo', (_, { content, isPrivate } = {}) => {
  ensureDir()
  const ts = formatTimestamp()
  const block = `## ${ts}\n${content}\n---**---\n`
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
    const memos = parseMemos(readPrivateContent()).filter(m => m.timestamp !== timestamp)
    writePrivateContent(serializeMemos(memos.slice().reverse()))
    return true
  }

  const file = yearMonth
    ? path.join(STORAGE_DIR, `${yearMonth}.md`)
    : getMonthFile()
  if (!fs.existsSync(file)) return false
  const memos = parseMemos(fs.readFileSync(file, 'utf-8')).filter(m => m.timestamp !== timestamp)
  fs.writeFileSync(file, serializeMemos(memos.slice().reverse()), 'utf-8')
  return true
})

// 跨所有月份搜索（返回带 yearMonth 字段的 memo 列表）
ipcMain.handle('search-memos', (_, { query, isPrivate }) => {
  ensureDir()
  const q = (query || '').toLowerCase()
  const tags = (q.match(/#[^#\s]\S*/g) || []).map(t => t.slice(1))        // ['tag1','tag2']
  const words = q.replace(/#[^#\s]\S*/g, '').trim().split(/\s+/).filter(Boolean) // 普通词

  const results = []

  if (isPrivate) {
    const content = readPrivateContent()
    parseMemos(content).forEach(memo => {
      const lower = memo.content.toLowerCase()
      const memoTags = (memo.content.match(/#[^#\s]\S*/g) || []).map(t => t.slice(1).toLowerCase())
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
      const memoTags = (memo.content.match(/#[^#\s]\S*/g) || []).map(t => t.slice(1).toLowerCase())
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

  const memos = parseMemos(text)
  const idx = memos.findIndex(m => m.timestamp === timestamp)
  if (idx === -1) return false
  const oldContent = memos[idx].content
  memos[idx].content = newContent

  if (!isPrivate) {
    const cfg = readConfig()
    cfg.history = cfg.history || {}
    cfg.history[timestamp] = cfg.history[timestamp] || []
    cfg.history[timestamp].unshift({ editedAt: formatTimestamp(), content: oldContent })
    if (cfg.history[timestamp].length > 10) cfg.history[timestamp].pop()
    saveConfig(cfg)
    syncTags(newContent)
  }

  const out = serializeMemos(memos.slice().reverse())
  if (isPrivate) writePrivateContent(out)
  else fs.writeFileSync(file, out, 'utf-8')
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

// ── 数据备份 ────────────────────────────────────────────
function getBackupDir() { return path.join(STORAGE_DIR, '.backup') }

function getDataSnapshotHash() {
  ensureDir()
  const md5 = crypto.createHash('md5')
  const files = []

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const rel = path.relative(STORAGE_DIR, full)
      if (rel === '.backup' || rel.startsWith(`.backup${path.sep}`)) continue
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.push(full)
    }
  }

  walk(STORAGE_DIR)
  files.sort()
  for (const file of files) {
    const rel = path.relative(STORAGE_DIR, file)
    md5.update(rel)
    md5.update('\0')
    md5.update(fs.readFileSync(file))
    md5.update('\0')
  }
  return md5.digest('hex')
}

function doBackup() {
  ensureDir()
  const cfg = getGlobalConfig()
  const currentHash = getDataSnapshotHash()
  if (cfg.lastBackupHash && cfg.lastBackupHash === currentHash) return false

  const backupDir = getBackupDir()
  if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true })
  const name = formatTimestamp().replace(/[: ]/g, '-')
  const dest = path.join(backupDir, name)
  fs.mkdirSync(dest, { recursive: true })
  for (const f of fs.readdirSync(STORAGE_DIR)) {
    if (f === '.backup') continue
    fs.cpSync(path.join(STORAGE_DIR, f), path.join(dest, f), { recursive: true })
  }
  // 清理超量旧备份
  const keep = Math.max(1, cfg.backupKeep || 5)
  const list = fs.readdirSync(backupDir).filter(f =>
    fs.statSync(path.join(backupDir, f)).isDirectory()
  ).sort()
  while (list.length > keep) {
    fs.rmSync(path.join(backupDir, list.shift()), { recursive: true, force: true })
  }
  cfg.lastBackupHash = currentHash
  saveGlobalConfig(cfg)
  return true
}

let backupTimer = null
function scheduleBackup() {
  if (backupTimer) clearInterval(backupTimer)
  const cfg = getGlobalConfig()
  const interval = cfg.backupInterval ?? 24
  const unit = cfg.backupUnit || 'hour'
  const hours = unit === 'day' ? interval * 24 : interval
  if (hours > 0) backupTimer = setInterval(doBackup, hours * 3600 * 1000)
}

ipcMain.handle('get-backup-config', () => {
  const cfg = getGlobalConfig()
  return {
    backupInterval: cfg.backupInterval ?? 24,
    backupKeep: cfg.backupKeep ?? 5,
    backupUnit: cfg.backupUnit || 'hour'
  }
})

ipcMain.handle('set-backup-config', (_, { backupInterval, backupKeep, backupUnit }) => {
  const cfg = getGlobalConfig()
  cfg.backupInterval = backupInterval
  cfg.backupKeep = backupKeep
  if (backupUnit) cfg.backupUnit = backupUnit
  saveGlobalConfig(cfg)
  scheduleBackup()
  return true
})

ipcMain.handle('list-backups', () => {
  const backupDir = getBackupDir()
  if (!fs.existsSync(backupDir)) return []
  return fs.readdirSync(backupDir)
    .filter(f => fs.statSync(path.join(backupDir, f)).isDirectory())
    .sort().reverse()
    .map(id => ({
      id,
      label: id.replace(/^(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})-(\d{2})$/, '$1 $2:$3:$4')
    }))
})

ipcMain.handle('run-backup-now', () => doBackup())

ipcMain.handle('delete-backup', (_, id) => {
  const target = path.join(getBackupDir(), id)
  if (!fs.existsSync(target)) return false
  fs.rmSync(target, { recursive: true, force: true })
  return true
})

ipcMain.handle('restore-backup', (_, id) => {
  const src = path.join(getBackupDir(), id)
  if (!fs.existsSync(src)) return false
  for (const f of fs.readdirSync(STORAGE_DIR)) {
    if (f === '.backup') continue
    fs.rmSync(path.join(STORAGE_DIR, f), { recursive: true, force: true })
  }
  for (const f of fs.readdirSync(src)) {
    fs.cpSync(path.join(src, f), path.join(STORAGE_DIR, f), { recursive: true })
  }
  return true
})

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

app.whenReady().then(() => { createWindow(); scheduleBackup() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
