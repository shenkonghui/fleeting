let currentMonth = null // 'YYYY-MM'，null = 当前月

// ── 工具 ──────────────────────────────────────────────
function currentYearMonth() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
}

function renderMarkdown(text) {
  return marked.parse(text)
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

// ── 渲染 memo 列表 ─────────────────────────────────────
async function loadMemos() {
  const memos = await window.api.getMemos(currentMonth)
  const list = document.getElementById('memo-list')
  const ym = currentMonth || currentYearMonth()
  document.getElementById('current-month-label').textContent = `📅 ${ym}`

  if (!memos.length) {
    list.innerHTML = '<div class="empty-tip">这个月还没有备忘，开始写第一条吧～</div>'
    return
  }
  list.innerHTML = ''
  memos.forEach(memo => list.appendChild(createCard(memo, ym)))
}

function createCard(memo, ym) {
  const card = document.createElement('div')
  card.className = 'memo-card'
  card.innerHTML = `
    <div class="memo-meta">
      <span>${memo.timestamp}</span>
      <button class="memo-delete" title="删除">🗑</button>
    </div>
    <div class="memo-body">${renderMarkdown(memo.content)}</div>
  `
  card.querySelector('.memo-delete').addEventListener('click', async () => {
    if (!confirm('确定删除这条备忘？')) return
    await window.api.deleteMemo({ yearMonth: ym, timestamp: memo.timestamp })
    await loadMemos()
    await loadMonths()
  })
  return card
}

// ── 切换月份 ───────────────────────────────────────────
async function switchMonth(m) {
  currentMonth = (m === currentYearMonth()) ? null : m
  await loadMonths()
  await loadMemos()
}

// ── 发送备忘 ───────────────────────────────────────────
async function submitMemo() {
  const editor = document.getElementById('editor')
  const content = editor.value.trim()
  if (!content) return

  // 若当前不在本月视图，切换回本月
  currentMonth = null
  await window.api.addMemo(content)
  editor.value = ''
  editor.style.height = 'auto'
  await loadMonths()
  await loadMemos()
}

// ── 事件绑定 ───────────────────────────────────────────
document.getElementById('submit-btn').addEventListener('click', submitMemo)

document.getElementById('editor').addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault()
    submitMemo()
  }
  // 自动撑高 textarea
  setTimeout(() => {
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px'
  }, 0)
})

document.getElementById('open-dir-btn').addEventListener('click', () => window.api.openStorageDir())

// ── 初始化 ────────────────────────────────────────────
;(async () => {
  await loadMonths()
  await loadMemos()
})()
