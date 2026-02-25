const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getMemos:       (yearMonth) => ipcRenderer.invoke('get-memos', yearMonth),
  getMonths:      ()          => ipcRenderer.invoke('get-months'),
  addMemo:        (content)   => ipcRenderer.invoke('add-memo', content),
  deleteMemo:     (info)      => ipcRenderer.invoke('delete-memo', info),
  searchMemos:    (query)     => ipcRenderer.invoke('search-memos', query),
  getTags:        ()          => ipcRenderer.invoke('get-tags'),
  editMemo:       (info)      => ipcRenderer.invoke('edit-memo', info),
  getHistory:     (timestamp) => ipcRenderer.invoke('get-history', timestamp),
  saveImage:      (info)      => ipcRenderer.invoke('save-image', info),
  openStorageDir: ()          => ipcRenderer.invoke('open-storage-dir'),
  getGlobalConfig:()          => ipcRenderer.invoke('get-global-config'),
  setGlobalConfig:(cfg)       => ipcRenderer.invoke('set-global-config', cfg),
  selectDirectory:()          => ipcRenderer.invoke('select-directory'),
})
