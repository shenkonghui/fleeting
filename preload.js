const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getMemos:       (yearMonth) => ipcRenderer.invoke('get-memos', yearMonth),
  getMonths:      ()          => ipcRenderer.invoke('get-months'),
  addMemo:        (content)   => ipcRenderer.invoke('add-memo', content),
  deleteMemo:     (info)      => ipcRenderer.invoke('delete-memo', info),
  searchMemos:    (query)     => ipcRenderer.invoke('search-memos', query),
  openStorageDir: ()          => ipcRenderer.invoke('open-storage-dir'),
})
