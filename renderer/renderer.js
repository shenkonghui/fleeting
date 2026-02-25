let currentMonth = null // 'YYYY-MM'，null = 当前月
let searchQuery = ''   // 当前搜索词
let allTags = []       // 从 config.yaml 加载的全量标签
let activeTag = ''     // 当前侧边栏选中的标签

// ── 工具 ──────────────────────────────────────────────
function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

// 将内容中的 #tag 替换为带样式的 badge，再 parse markdown
function renderMarkdown(text) {
  const withTags = text.replace(/(^|\s)(#\S+)/g, (_, pre, tag) =>
    `${pre}<span class="tag-badge">${tag}</span>`)
  return marked.parse(withTags)
}

// ── 渲染侧边栏标签列表 ─────────────────────────────────
function renderTagList() {
  const nav = document.getElementById('tag-list')
  const label = document.getElementById('tag-section-label')
  nav.innerHTML = ''
  label.style.display = allTags.length ? 'block' : 'none'
  allTags.forEach(tag => {
    const item = document.createElement('div')
    item.className = 'tag-item' + (activeTag === tag ? ' active' : '')
    item.textContent = `#${tag}`
    item.addEventListener('click', () => filterByTag(tag))
    nav.appendChild(item)
  })
}

function filterByTag(tag) {
  if (activeTag === tag) {
    // 再次点击取消过滤
    activeTag = ''
    searchQuery = ''
    document.getElementById('search-input').value = ''
    document.getElementById('search-clear').style.display = 'none'
  } else {
    activeTag = tag
    searchQuery = `#${tag}`
    document.getElementById('search-input').value = `#${tag}`
    document.getElementById('search-clear').style.display = 'flex'
  }
  renderTagList()
  loadMemos()
}

// ── 渲染月份列表 ───────────────────────────────────────
async function loadMonths() {
  const months = await window.api.getMonths()
  const cur = currentMonth || currentYearMonth()

  // 确保当前月始终出现在列表中
  if (!months.includes(cur)) months.unshift(cur)

  const nav = document.getElementById('month-list')
  nav.innerHTML = ''
  months.forEach(m => {
    const item = document.createElement('div')
    item.className = 'month-item' + (m === cur ? ' active' : '')
    item.textContent = m
    item.addEventListener('click', () => switchMonth(m))
    nav.appendChild(item)
  })
}

// ── 渲染 memo 列表（支持搜索模式）─────────────────────
async function loadMemos() {
  const list = document.getElementById('memo-list')
  let memos, isSearch = false

  if (searchQuery) {
    isSearch = true
    memos = await window.api.searchMemos(searchQuery)
    document.getElementById('current-month-label').textContent = `🔍 搜索：${searchQuery}`
  } else {
    const ym = currentMonth || currentYearMonth()
    memos = (await window.api.getMemos(currentMonth)).map(m => ({ ...m, yearMonth: ym }))
    document.getElementById('current-month-label').textContent = `📅 ${ym}`
  }

  if (!memos.length) {
    list.innerHTML = `<div class="empty-tip">${isSearch ? '没有找到匹配的备忘' : '这个月还没有备忘，开始写第一条吧～'}</div>`
    return
  }
  list.innerHTML = ''
  memos.forEach(memo => list.appendChild(createCard(memo, memo.yearMonth)))
}

function createCard(memo, ym) {
  const card = document.createElement('div')
  card.className = 'memo-card'
  const label = searchQuery ? `<span class="memo-month">${ym}</span>` : ''
  card.innerHTML = `
    <div class="memo-meta">
      <span>${memo.timestamp}${label}</span>
      <span class="memo-actions">
        <button class="memo-edit" title="编辑">✏️</button>
        <button class="memo-delete" title="删除">🗑</button>
      </span>
    </div>
    <div class="memo-body">${renderMarkdown(memo.content)}</div>
  `
  card.querySelector('.memo-delete').addEventListener('click', async () => {
    if (!confirm('确定删除这条备忘？')) return
    await window.api.deleteMemo({ yearMonth: ym, timestamp: memo.timestamp })
    await loadMemos()
    await loadMonths()
  })
  card.querySelector('.memo-edit').addEventListener('click', async () => {
    const body = card.querySelector('.memo-body')
    const histories = await window.api.getHistory(memo.timestamp)
    const histHtml = histories.length
      ? `<div class="edit-history"><div class="history-title">编辑历史</div>${histories.map(h =>
          `<div class="history-item"><span class="history-time">${h.editedAt}</span><pre>${h.content}</pre></div>`
        ).join('')}</div>`
      : ''
    body.innerHTML = `
      <textarea class="edit-textarea">${memo.content}</textarea>
      <div class="edit-actions">
        <button class="edit-save">保存</button>
        <button class="edit-cancel">取消</button>
      </div>${histHtml}`
    body.querySelector('.edit-save').addEventListener('click', async () => {
      const newContent = body.querySelector('.edit-textarea').value.trim()
      if (!newContent) return
      await window.api.editMemo({ yearMonth: ym, timestamp: memo.timestamp, newContent })
      await loadMemos()
    })
    body.querySelector('.edit-cancel').addEventListener('click', () => {
      body.innerHTML = renderMarkdown(memo.content)
    })
  })
  return card
}

// ── 切换月份 ───────────────────────────────────────────
async function switchMonth(m) {
  activeTag = ''
  searchQuery = ''
  document.getElementById('search-input').value = ''
  document.getElementById('search-clear').style.display = 'none'
  currentMonth = (m === currentYearMonth()) ? null : m
  renderTagList()
  await loadMonths()
  await loadMemos()
}

// ── 发送备忘 ───────────────────────────────────────────
async function submitMemo() {
  const editor = document.getElementById('editor')
  const content = editor.value.trim()
  if (!content) return

  hideTagDropdown()
  currentMonth = null
  await window.api.addMemo(content)
  // 发送后重新加载标签（可能新增了标签）
  allTags = await window.api.getTags()
  renderTagList()
  editor.value = ''
  editor.style.height = 'auto'
  await loadMonths()
  await loadMemos()
}

// ── 标签自动补全 ───────────────────────────────────────
const dropdown = document.getElementById('tag-dropdown')
let acIndex = -1   // 当前高亮项

function getTagContext(textarea) {
  const text = textarea.value.slice(0, textarea.selectionStart)
  const m = text.match(/(^|\s)#(\S*)$/)
  return m ? m[2] : null // 返回 # 后的已输入部分，无匹配返回 null
}

function showTagDropdown(matches) {
  acIndex = -1
  dropdown.innerHTML = ''
  matches.forEach((tag, i) => {
    const item = document.createElement('div')
    item.className = 'tag-ac-item'
    item.textContent = `#${tag}`
    item.addEventListener('mousedown', e => {
      e.preventDefault() // 防止 textarea 失焦
      applyTag(tag)
    })
    dropdown.appendChild(item)
  })
  dropdown.style.display = 'block'
}

function hideTagDropdown() {
  dropdown.style.display = 'none'
  acIndex = -1
}

function setActiveItem(idx) {
  const items = dropdown.querySelectorAll('.tag-ac-item')
  items.forEach((el, i) => el.classList.toggle('active', i === idx))
}

function applyTag(tag) {
  const editor = document.getElementById('editor')
  const before = editor.value.slice(0, editor.selectionStart)
  const after = editor.value.slice(editor.selectionStart)
  const replaced = before.replace(/(^|\s)#\S*$/, (_, pre) => `${pre}#${tag} `)
  editor.value = replaced + after
  editor.selectionStart = editor.selectionEnd = replaced.length
  hideTagDropdown()
  editor.focus()
}

// ── 事件绑定 ───────────────────────────────────────────
document.getElementById('submit-btn').addEventListener('click', submitMemo)

// ── 粘贴图片 ───────────────────────────────────────────
document.getElementById('editor').addEventListener('paste', async e => {
  const imgItem = Array.from(e.clipboardData.items).find(it => it.type.startsWith('image/'))
  if (!imgItem) return
  e.preventDefault()
  const ext = imgItem.type.split('/')[1].replace('jpeg', 'jpg') || 'png'
  const reader = new FileReader()
  reader.onload = async () => {
    const filepath = await window.api.saveImage({ data: reader.result.split(',')[1], ext })
    const editor = document.getElementById('editor')
    const pos = editor.selectionStart
    const insert = `![](file://${filepath})`
    editor.value = editor.value.slice(0, pos) + insert + editor.value.slice(pos)
    editor.selectionStart = editor.selectionEnd = pos + insert.length
  }
  reader.readAsDataURL(imgItem.getAsFile())
})

document.getElementById('editor').addEventListener('keydown', e => {
  const isOpen = dropdown.style.display === 'block'
  const items = dropdown.querySelectorAll('.tag-ac-item')

  if (isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
    e.preventDefault()
    acIndex = e.key === 'ArrowDown'
      ? Math.min(acIndex + 1, items.length - 1)
      : Math.max(acIndex - 1, 0)
    setActiveItem(acIndex)
    return
  }

  if (isOpen && (e.key === 'Enter' || e.key === 'Tab')) {
    if (acIndex >= 0 && items[acIndex]) {
      e.preventDefault()
      applyTag(items[acIndex].textContent.slice(1)) // 去掉前缀 #
      return
    }
  }

  if (isOpen && e.key === 'Escape') {
    hideTagDropdown()
    return
  }

  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    submitMemo()
    return
  }

  // 自动撑高 textarea
  setTimeout(() => {
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
  }, 0)
})

document.getElementById('editor').addEventListener('input', e => {
  const partial = getTagContext(e.target)
  if (partial === null) { hideTagDropdown(); return }
  const matches = allTags.filter(t => t.toLowerCase().startsWith(partial.toLowerCase()))
  if (matches.length) showTagDropdown(matches)
  else hideTagDropdown()
})

document.getElementById('open-dir-btn').addEventListener('click', () => window.api.openStorageDir())

// ── 搜索 ──────────────────────────────────────────────
let searchTimer = null
document.getElementById('search-input').addEventListener('input', e => {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => {
    searchQuery = e.target.value.trim()
    activeTag = ''
    renderTagList()
    document.getElementById('search-clear').style.display = searchQuery ? 'flex' : 'none'
    await loadMemos()
  }, 200)
})

document.getElementById('search-clear').addEventListener('click', async () => {
  activeTag = ''
  searchQuery = ''
  document.getElementById('search-input').value = ''
  document.getElementById('search-clear').style.display = 'none'
  renderTagList()
  await loadMemos()
})

// 点击 tag-badge 自动填入搜索框
document.getElementById('memo-list').addEventListener('click', e => {
  if (e.target.classList.contains('tag-badge')) {
    const tag = e.target.textContent
    document.getElementById('search-input').value = tag
    searchQuery = tag
    document.getElementById('search-clear').style.display = 'flex'
    loadMemos()
  }
})

// ── 设置 ──────────────────────────────────────────────
const settingsModal = document.getElementById('settings-modal')
const storageInput = document.getElementById('storage-dir-input')

document.getElementById('settings-btn').addEventListener('click', async () => {
  const config = await window.api.getGlobalConfig()
  storageInput.value = config.storageDir
  settingsModal.style.display = 'flex'
})

document.getElementById('close-settings-btn').addEventListener('click', () => {
  settingsModal.style.display = 'none'
})

document.getElementById('browse-dir-btn').addEventListener('click', async () => {
  const dir = await window.api.selectDirectory()
  if (dir) storageInput.value = dir
})

document.getElementById('save-settings-btn').addEventListener('click', async () => {
  const newDir = storageInput.value
  if (!newDir) return
  await window.api.setGlobalConfig({ storageDir: newDir })
  settingsModal.style.display = 'none'
  // 重载数据
  allTags = await window.api.getTags()
  renderTagList()
  await loadMonths()
  await loadMemos()
})

// ── 初始化 ────────────────────────────────────────────
;(async () => {
  allTags = await window.api.getTags()
  renderTagList()
  await loadMonths()
  await loadMemos()
})()
